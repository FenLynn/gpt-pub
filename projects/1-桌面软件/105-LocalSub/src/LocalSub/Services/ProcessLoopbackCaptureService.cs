using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace LocalSub.Services;

public sealed class ProcessLoopbackCaptureService : IDisposable
{
    const string VirtualAudioDeviceProcessLoopback = "VAD\\Process_Loopback";
    const int MinimumSupportedBuild = 19041;

    const uint AudclntStreamflagsLoopback = 0x00020000;
    const uint AudclntStreamflagsEventCallback = 0x00040000;
    const uint AudclntStreamflagsAutoConvertPcm = 0x80000000;
    const uint AudclntBufferflagsSilent = 0x00000002;

    static readonly Guid IID_IAudioClient = new("1CB9AD4C-DBFA-4C32-B178-C2F568A703B2");
    static readonly Guid IID_IAudioCaptureClient = new("C8ADBD64-E71E-48A0-A4DE-185C395CD317");

    RawAudioClient? _audioClient;
    RawAudioCaptureClient? _captureClient;
    AutoResetEvent? _sampleReady;
    CancellationTokenSource? _cts;
    Task? _worker;
    readonly StreamingResampler _resampler = new(44100, 16000);

    public event Action<float>? LevelChanged;
    public event Action<float[]>? SamplesAvailable;

    public static int WindowsBuild => GetWindowsBuild();
    public static bool IsSupported => OperatingSystem.IsWindows() && WindowsBuild >= MinimumSupportedBuild;

    public static void EnsureSupported()
    {
        if (!OperatingSystem.IsWindows())
            throw new PlatformNotSupportedException("PotPlayer 专用音频捕获仅支持 Windows。");

        var build = WindowsBuild;
        if (build < MinimumSupportedBuild)
        {
            throw new PlatformNotSupportedException(
                $"当前 Windows build {build} 低于 Process Loopback 的最低尝试版本 {MinimumSupportedBuild}。当前系统请使用“所有音频”模式；LocalSub 不会静默回退为全系统音频。");
        }
    }

    public async Task StartAsync(uint processId, CancellationToken ct = default)
    {
        if (_audioClient != null) return;
        EnsureSupported();
        ct.ThrowIfCancellationRequested();

        try
        {
            var clientPtr = await ActivateProcessLoopbackAsync(processId, ct).ConfigureAwait(false);
            _audioClient = new RawAudioClient(clientPtr);

            // Match Microsoft's ApplicationLoopback sample: explicit 44.1 kHz 16-bit stereo PCM,
            // shared mode, LOOPBACK + EVENTCALLBACK + AUTOCONVERTPCM.
            var format = WaveFormatEx.Pcm44100Stereo16;
            _audioClient.Initialize(
                shareMode: 0,
                streamFlags: AudclntStreamflagsLoopback | AudclntStreamflagsEventCallback | AudclntStreamflagsAutoConvertPcm,
                bufferDuration: 0,
                periodicity: 0,
                format);

            _captureClient = _audioClient.GetCaptureClient();
            _sampleReady = new AutoResetEvent(false);
            _audioClient.SetEventHandle(_sampleReady.SafeWaitHandle.DangerousGetHandle());
            _audioClient.Start();

            _cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            _worker = Task.Run(() => CaptureLoopAsync(_cts.Token), _cts.Token);
        }
        catch (COMException ex)
        {
            await StopAsync().ConfigureAwait(false);
            throw new COMException(
                $"PotPlayer 专用音频捕获启动失败。Windows build {WindowsBuild}，HRESULT 0x{ex.HResult:X8}。{ex.Message}",
                ex.HResult);
        }
        catch
        {
            await StopAsync().ConfigureAwait(false);
            throw;
        }
    }

    async Task CaptureLoopAsync(CancellationToken ct)
    {
        const int bytesPerFrame = 4; // 16-bit stereo
        try
        {
            while (!ct.IsCancellationRequested)
            {
                var signal = _sampleReady;
                if (signal == null) break;

                signal.WaitOne(100);
                ct.ThrowIfCancellationRequested();

                var capture = _captureClient;
                if (capture == null) break;

                while (!ct.IsCancellationRequested && capture.GetNextPacketSize() > 0)
                {
                    var ptr = capture.GetBuffer(out var frames, out var flags);
                    try
                    {
                        if (frames == 0) continue;

                        var mono = new float[frames];
                        var peak = 0f;
                        if ((flags & AudclntBufferflagsSilent) == 0 && ptr != IntPtr.Zero)
                        {
                            var bytes = new byte[checked((int)frames * bytesPerFrame)];
                            Marshal.Copy(ptr, bytes, 0, bytes.Length);
                            for (var i = 0; i < frames; i++)
                            {
                                var offset = checked((int)i * 4);
                                var left = BitConverter.ToInt16(bytes, offset) / 32768f;
                                var right = BitConverter.ToInt16(bytes, offset + 2) / 32768f;
                                var sample = (left + right) * 0.5f;
                                mono[i] = sample;
                                peak = Math.Max(peak, Math.Abs(sample));
                            }
                        }

                        LevelChanged?.Invoke(Math.Clamp(peak, 0, 1));
                        var samples16k = _resampler.Process(mono);
                        if (samples16k.Length > 0) SamplesAvailable?.Invoke(samples16k);
                    }
                    finally
                    {
                        capture.ReleaseBuffer(frames);
                    }
                }

                await Task.Yield();
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { }
    }

    static async Task<IntPtr> ActivateProcessLoopbackAsync(uint processId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();

        var activationParams = new AudioClientActivationParams
        {
            ActivationType = AudioClientActivationType.ProcessLoopback,
            ProcessLoopbackParams = new AudioClientProcessLoopbackParams
            {
                TargetProcessId = processId,
                ProcessLoopbackMode = ProcessLoopbackMode.IncludeTargetProcessTree
            }
        };

        var paramsSize = Marshal.SizeOf<AudioClientActivationParams>();
        var paramsPtr = Marshal.AllocHGlobal(paramsSize);
        var propPtr = Marshal.AllocHGlobal(Marshal.SizeOf<PropVariantBlobHeader>());
        IActivateAudioInterfaceAsyncOperationRaw? operation = null;
        try
        {
            Marshal.StructureToPtr(activationParams, paramsPtr, false);
            var prop = new PropVariantBlobHeader
            {
                Vt = 65,
                BlobSize = (uint)paramsSize,
                BlobData = paramsPtr
            };
            Marshal.StructureToPtr(prop, propPtr, false);

            var handler = new CompletionHandler();
            var iid = IID_IAudioClient;
            var hr = ActivateAudioInterfaceAsync(
                VirtualAudioDeviceProcessLoopback,
                ref iid,
                propPtr,
                handler,
                out operation);
            ThrowIfFailed(hr, "启动 Windows Process Loopback");

            var clientPtr = await handler.Task.ConfigureAwait(false);
            ct.ThrowIfCancellationRequested();
            GC.KeepAlive(operation);
            return clientPtr;
        }
        finally
        {
            if (operation != null && Marshal.IsComObject(operation))
            {
                try { Marshal.ReleaseComObject(operation); } catch { }
            }
            Marshal.FreeHGlobal(propPtr);
            Marshal.FreeHGlobal(paramsPtr);
        }
    }

    public async Task StopAsync()
    {
        if (_cts != null)
        {
            try { _cts.Cancel(); } catch { }
        }
        try { _sampleReady?.Set(); } catch { }

        if (_worker != null)
        {
            try { await _worker.ConfigureAwait(false); } catch (OperationCanceledException) { }
        }

        try { _audioClient?.Stop(); } catch { }

        _captureClient?.Dispose();
        _captureClient = null;
        _audioClient?.Dispose();
        _audioClient = null;
        _sampleReady?.Dispose();
        _sampleReady = null;
        _worker = null;
        _cts?.Dispose();
        _cts = null;
        LevelChanged?.Invoke(0);
    }

    public void Dispose() => StopAsync().GetAwaiter().GetResult();

    sealed class CompletionHandler : IActivateAudioInterfaceCompletionHandlerRaw, IAgileObject
    {
        readonly TaskCompletionSource<IntPtr> _tcs = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public Task<IntPtr> Task => _tcs.Task;

        public void ActivateCompleted(IActivateAudioInterfaceAsyncOperationRaw activateOperation)
        {
            IntPtr unknown = IntPtr.Zero;
            IntPtr client = IntPtr.Zero;
            try
            {
                var callHr = activateOperation.GetActivateResult(out var activateHr, out unknown);
                ThrowIfFailed(callHr, "读取 Process Loopback 激活结果");
                ThrowIfFailed(activateHr, "激活 Process Loopback 音频接口");
                if (unknown == IntPtr.Zero)
                    throw new COMException("Windows 返回了空的 Process Loopback 音频接口。");

                var iid = IID_IAudioClient;
                var qiHr = Marshal.QueryInterface(unknown, ref iid, out client);
                ThrowIfFailed(qiHr, "获取 IAudioClient");
                if (client == IntPtr.Zero)
                    throw new COMException("Windows 未返回 IAudioClient 指针。");

                if (!_tcs.TrySetResult(client))
                {
                    Marshal.Release(client);
                    client = IntPtr.Zero;
                }
                else
                {
                    client = IntPtr.Zero;
                }
            }
            catch (Exception ex)
            {
                _tcs.TrySetException(ex);
            }
            finally
            {
                if (client != IntPtr.Zero) Marshal.Release(client);
                if (unknown != IntPtr.Zero) Marshal.Release(unknown);
            }
        }
    }

    sealed class RawAudioClient : IDisposable
    {
        IntPtr _ptr;

        public RawAudioClient(IntPtr ptr)
        {
            _ptr = ptr != IntPtr.Zero ? ptr : throw new ArgumentNullException(nameof(ptr));
        }

        public void Initialize(int shareMode, uint streamFlags, long bufferDuration, long periodicity, WaveFormatEx format)
        {
            var formatPtr = Marshal.AllocHGlobal(Marshal.SizeOf<WaveFormatEx>());
            try
            {
                Marshal.StructureToPtr(format, formatPtr, false);
                var hr = GetDelegate<InitializeDelegate>(3)(_ptr, shareMode, streamFlags, bufferDuration, periodicity, formatPtr, IntPtr.Zero);
                ThrowIfFailed(hr, "初始化 Process Loopback IAudioClient");
            }
            finally
            {
                Marshal.FreeHGlobal(formatPtr);
            }
        }

        public RawAudioCaptureClient GetCaptureClient()
        {
            var iid = IID_IAudioCaptureClient;
            var hr = GetDelegate<GetServiceDelegate>(14)(_ptr, ref iid, out var servicePtr);
            ThrowIfFailed(hr, "获取 IAudioCaptureClient");
            if (servicePtr == IntPtr.Zero) throw new COMException("Windows 返回了空的 IAudioCaptureClient 指针。");
            return new RawAudioCaptureClient(servicePtr);
        }

        public void SetEventHandle(IntPtr handle)
        {
            var hr = GetDelegate<SetEventHandleDelegate>(13)(_ptr, handle);
            ThrowIfFailed(hr, "设置 Process Loopback 采样事件");
        }

        public void Start()
        {
            var hr = GetDelegate<SimpleHResultDelegate>(10)(_ptr);
            ThrowIfFailed(hr, "启动 Process Loopback 捕获");
        }

        public void Stop()
        {
            if (_ptr == IntPtr.Zero) return;
            var hr = GetDelegate<SimpleHResultDelegate>(11)(_ptr);
            ThrowIfFailed(hr, "停止 Process Loopback 捕获");
        }

        T GetDelegate<T>(int slot) where T : Delegate
        {
            if (_ptr == IntPtr.Zero) throw new ObjectDisposedException(nameof(RawAudioClient));
            var vtable = Marshal.ReadIntPtr(_ptr);
            var fn = Marshal.ReadIntPtr(vtable, slot * IntPtr.Size);
            return Marshal.GetDelegateForFunctionPointer<T>(fn);
        }

        public void Dispose()
        {
            var ptr = Interlocked.Exchange(ref _ptr, IntPtr.Zero);
            if (ptr != IntPtr.Zero) Marshal.Release(ptr);
        }

        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        delegate int InitializeDelegate(IntPtr self, int shareMode, uint streamFlags, long bufferDuration, long periodicity, IntPtr format, IntPtr audioSessionGuid);

        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        delegate int GetServiceDelegate(IntPtr self, ref Guid riid, out IntPtr service);

        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        delegate int SetEventHandleDelegate(IntPtr self, IntPtr eventHandle);

        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        delegate int SimpleHResultDelegate(IntPtr self);
    }

    sealed class RawAudioCaptureClient : IDisposable
    {
        IntPtr _ptr;

        public RawAudioCaptureClient(IntPtr ptr)
        {
            _ptr = ptr != IntPtr.Zero ? ptr : throw new ArgumentNullException(nameof(ptr));
        }

        public uint GetNextPacketSize()
        {
            var hr = GetDelegate<GetNextPacketSizeDelegate>(5)(_ptr, out var frames);
            ThrowIfFailed(hr, "读取 Process Loopback 包大小");
            return frames;
        }

        public IntPtr GetBuffer(out uint frames, out uint flags)
        {
            var hr = GetDelegate<GetBufferDelegate>(3)(_ptr, out var data, out frames, out flags, out _, out _);
            ThrowIfFailed(hr, "读取 Process Loopback 音频缓冲区");
            return data;
        }

        public void ReleaseBuffer(uint frames)
        {
            var hr = GetDelegate<ReleaseBufferDelegate>(4)(_ptr, frames);
            ThrowIfFailed(hr, "释放 Process Loopback 音频缓冲区");
        }

        T GetDelegate<T>(int slot) where T : Delegate
        {
            if (_ptr == IntPtr.Zero) throw new ObjectDisposedException(nameof(RawAudioCaptureClient));
            var vtable = Marshal.ReadIntPtr(_ptr);
            var fn = Marshal.ReadIntPtr(vtable, slot * IntPtr.Size);
            return Marshal.GetDelegateForFunctionPointer<T>(fn);
        }

        public void Dispose()
        {
            var ptr = Interlocked.Exchange(ref _ptr, IntPtr.Zero);
            if (ptr != IntPtr.Zero) Marshal.Release(ptr);
        }

        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        delegate int GetBufferDelegate(IntPtr self, out IntPtr data, out uint frames, out uint flags, out ulong devicePosition, out ulong qpcPosition);

        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        delegate int ReleaseBufferDelegate(IntPtr self, uint frames);

        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        delegate int GetNextPacketSizeDelegate(IntPtr self, out uint frames);
    }

    [ComImport, Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IActivateAudioInterfaceAsyncOperationRaw
    {
        [PreserveSig]
        int GetActivateResult(out int activateResult, out IntPtr activateInterface);
    }

    [ComImport, Guid("41D949AB-9862-444A-80F6-C261334DA5EB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IActivateAudioInterfaceCompletionHandlerRaw
    {
        void ActivateCompleted(IActivateAudioInterfaceAsyncOperationRaw activateOperation);
    }

    [ComImport, Guid("94EA2B94-E9CC-49E0-C0FF-EE64CA8F5B90"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAgileObject { }

    enum AudioClientActivationType : int { Default = 0, ProcessLoopback = 1 }
    enum ProcessLoopbackMode : int { IncludeTargetProcessTree = 0, ExcludeTargetProcessTree = 1 }

    [StructLayout(LayoutKind.Sequential)]
    struct AudioClientProcessLoopbackParams
    {
        public uint TargetProcessId;
        public ProcessLoopbackMode ProcessLoopbackMode;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct AudioClientActivationParams
    {
        public AudioClientActivationType ActivationType;
        public AudioClientProcessLoopbackParams ProcessLoopbackParams;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct PropVariantBlobHeader
    {
        public ushort Vt;
        public ushort Reserved1;
        public ushort Reserved2;
        public ushort Reserved3;
        public uint BlobSize;
        public IntPtr BlobData;
    }

    [StructLayout(LayoutKind.Sequential, Pack = 2)]
    struct WaveFormatEx
    {
        public ushort FormatTag;
        public ushort Channels;
        public uint SamplesPerSec;
        public uint AvgBytesPerSec;
        public ushort BlockAlign;
        public ushort BitsPerSample;
        public ushort ExtraSize;

        public static WaveFormatEx Pcm44100Stereo16 => new()
        {
            FormatTag = 1,
            Channels = 2,
            SamplesPerSec = 44100,
            AvgBytesPerSec = 44100 * 4,
            BlockAlign = 4,
            BitsPerSample = 16,
            ExtraSize = 0
        };
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct RtlOsVersionInfoEx
    {
        public uint Size;
        public uint Major;
        public uint Minor;
        public uint Build;
        public uint PlatformId;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string CsdVersion;
        public ushort ServicePackMajor;
        public ushort ServicePackMinor;
        public ushort SuiteMask;
        public byte ProductType;
        public byte Reserved;
    }

    static int GetWindowsBuild()
    {
        if (!OperatingSystem.IsWindows()) return 0;
        try
        {
            var version = new RtlOsVersionInfoEx
            {
                Size = (uint)Marshal.SizeOf<RtlOsVersionInfoEx>(),
                CsdVersion = string.Empty
            };
            var status = RtlGetVersion(ref version);
            return status == 0 ? checked((int)version.Build) : Environment.OSVersion.Version.Build;
        }
        catch
        {
            return Environment.OSVersion.Version.Build;
        }
    }

    static void ThrowIfFailed(int hr, string action)
    {
        if (hr < 0) throw new COMException($"{action}失败，HRESULT 0x{hr:X8}。", hr);
    }

    [DllImport("ntdll.dll")]
    static extern int RtlGetVersion(ref RtlOsVersionInfoEx version);

    [DllImport("Mmdevapi.dll", ExactSpelling = true, PreserveSig = true)]
    static extern int ActivateAudioInterfaceAsync(
        [In, MarshalAs(UnmanagedType.LPWStr)] string deviceInterfacePath,
        ref Guid riid,
        IntPtr activationParams,
        [MarshalAs(UnmanagedType.Interface)] IActivateAudioInterfaceCompletionHandlerRaw completionHandler,
        out IActivateAudioInterfaceAsyncOperationRaw activationOperation);

    sealed class StreamingResampler
    {
        readonly double _step;
        long _sourceIndex;
        double _nextOutputPosition;
        bool _hasPrevious;
        float _previous;

        public StreamingResampler(int sourceRate, int targetRate) => _step = sourceRate / (double)targetRate;

        public float[] Process(float[] input)
        {
            if (input.Length == 0) return [];
            var output = new List<float>((int)Math.Ceiling(input.Length / _step) + 2);
            foreach (var current in input)
            {
                if (!_hasPrevious)
                {
                    _previous = current;
                    _hasPrevious = true;
                    _sourceIndex = 0;
                    _nextOutputPosition = 0;
                    output.Add(current);
                    _nextOutputPosition += _step;
                    continue;
                }

                _sourceIndex++;
                var start = _sourceIndex - 1.0;
                while (_nextOutputPosition <= _sourceIndex)
                {
                    var t = Math.Clamp(_nextOutputPosition - start, 0, 1);
                    output.Add((float)(_previous + (current - _previous) * t));
                    _nextOutputPosition += _step;
                }
                _previous = current;
            }
            return output.ToArray();
        }
    }
}
