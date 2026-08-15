using System.Runtime.InteropServices;
using NAudio.CoreAudioApi;
using NAudio.CoreAudioApi.Interfaces;
using NAudio.Wasapi.CoreAudioApi.Interfaces;
using NAudio.Wave;

namespace LocalSub.Services;

public sealed class ProcessLoopbackCaptureService : IDisposable
{
    const string VirtualAudioDeviceProcessLoopback = "VAD\\Process_Loopback";
    static readonly Guid IID_IAudioClient = new("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2");

    AudioClient? _audioClient;
    AudioCaptureClient? _captureClient;
    CancellationTokenSource? _cts;
    Task? _worker;
    readonly StreamingResampler _resampler = new(44100, 16000);

    public event Action<float>? LevelChanged;
    public event Action<float[]>? SamplesAvailable;

    public async Task StartAsync(uint processId, CancellationToken ct = default)
    {
        if (_audioClient != null) return;
        if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 19041))
            throw new PlatformNotSupportedException("PotPlayer 专用音频捕获需要 Windows 10 2004（build 19041）或更高版本。 ");

        var clientInterface = await ActivateProcessLoopbackAsync(processId, ct);
        _audioClient = new AudioClient(clientInterface);

        // Follow Microsoft's ApplicationLoopback sample: explicit shared PCM format with engine conversion.
        var format = new WaveFormat(44100, 16, 2);
        var flags = AudioClientStreamFlags.Loopback | AudioClientStreamFlags.AutoConvertPcm | AudioClientStreamFlags.SrcDefaultQuality;
        _audioClient.Initialize(AudioClientShareMode.Shared, flags, 0, 0, format, Guid.Empty);
        _captureClient = _audioClient.AudioCaptureClient;
        _audioClient.Start();

        _cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        _worker = Task.Run(() => CaptureLoopAsync(_cts.Token), _cts.Token);
    }

    async Task CaptureLoopAsync(CancellationToken ct)
    {
        var bytesPerFrame = 4; // 16-bit stereo
        try
        {
            while (!ct.IsCancellationRequested)
            {
                var hadPacket = false;
                while (!ct.IsCancellationRequested && _captureClient != null && _captureClient.GetNextPacketSize() > 0)
                {
                    hadPacket = true;
                    var ptr = _captureClient.GetBuffer(out var frames, out var flags);
                    try
                    {
                        if (frames <= 0) continue;
                        var mono = new float[frames];
                        var peak = 0f;
                        if ((flags & AudioClientBufferFlags.Silent) == 0 && ptr != IntPtr.Zero)
                        {
                            var bytes = new byte[frames * bytesPerFrame];
                            Marshal.Copy(ptr, bytes, 0, bytes.Length);
                            for (var i = 0; i < frames; i++)
                            {
                                var left = BitConverter.ToInt16(bytes, i * 4) / 32768f;
                                var right = BitConverter.ToInt16(bytes, i * 4 + 2) / 32768f;
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
                        _captureClient.ReleaseBuffer(frames);
                    }
                }

                if (!hadPacket) await Task.Delay(8, ct);
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { }
    }

    static async Task<IAudioClient> ActivateProcessLoopbackAsync(uint processId, CancellationToken ct)
    {
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
        try
        {
            Marshal.StructureToPtr(activationParams, paramsPtr, false);
            var prop = new PropVariantBlobHeader
            {
                Vt = 65, // VT_BLOB
                BlobSize = (uint)paramsSize,
                BlobData = paramsPtr
            };
            Marshal.StructureToPtr(prop, propPtr, false);

            var handler = new CompletionHandler();
            ActivateAudioInterfaceAsync(VirtualAudioDeviceProcessLoopback, IID_IAudioClient, propPtr, handler, out var operation);
            using var registration = ct.Register(() => handler.TryCancel(ct));
            GC.KeepAlive(operation);
            return await handler.Task.ConfigureAwait(false);
        }
        finally
        {
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
        if (_worker != null)
        {
            try { await _worker; } catch (OperationCanceledException) { }
        }
        try { _audioClient?.Stop(); } catch { }
        _captureClient?.Dispose();
        _captureClient = null;
        _audioClient?.Dispose();
        _audioClient = null;
        _worker = null;
        _cts?.Dispose();
        _cts = null;
        LevelChanged?.Invoke(0);
    }

    public void Dispose() => StopAsync().GetAwaiter().GetResult();

    [ComVisible(true), ClassInterface(ClassInterfaceType.None)]
    sealed class CompletionHandler : IActivateAudioInterfaceCompletionHandler, IAgileObject
    {
        readonly TaskCompletionSource<IAudioClient> _tcs = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public Task<IAudioClient> Task => _tcs.Task;

        public void ActivateCompleted(IActivateAudioInterfaceAsyncOperation activateOperation)
        {
            try
            {
                activateOperation.GetActivateResult(out var hr, out var unk);
                if (hr != 0) Marshal.ThrowExceptionForHR(hr);
                _tcs.TrySetResult((IAudioClient)unk);
            }
            catch (Exception ex) { _tcs.TrySetException(ex); }
        }

        public void TryCancel(CancellationToken ct) => _tcs.TrySetCanceled(ct);
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

    [DllImport("Mmdevapi.dll", ExactSpelling = true, PreserveSig = false)]
    static extern void ActivateAudioInterfaceAsync(
        [In, MarshalAs(UnmanagedType.LPWStr)] string deviceInterfacePath,
        [In, MarshalAs(UnmanagedType.LPStruct)] Guid riid,
        [In] IntPtr activationParams,
        [In] IActivateAudioInterfaceCompletionHandler completionHandler,
        out IActivateAudioInterfaceAsyncOperation activationOperation);

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
