using System.Diagnostics;
using System.Globalization;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;

namespace LocalSub.Services;

public interface IMediaAudioSource : IDisposable
{
    TimeSpan Duration { get; }
    int SampleRate { get; }
    int Channels { get; }
    string DecoderName { get; }
    int Read(float[] buffer, int offset, int count);
}

public static class MediaAudioSource
{
    public static IMediaAudioSource Open(string filePath, FfmpegManager? ffmpeg = null)
    {
        try
        {
            return new MediaFoundationAudioSource(filePath);
        }
        catch (Exception ex) when (ex is System.Runtime.InteropServices.COMException or InvalidOperationException or NotSupportedException)
        {
            if (ffmpeg?.IsInstalled == true) return new FfmpegAudioSource(filePath, ffmpeg);
            throw new NotSupportedException("Windows Media Foundation 无法解析该媒体。请在后台转写页安装 FFmpeg 组件后重试。", ex);
        }
    }

    sealed class MediaFoundationAudioSource : IMediaAudioSource
    {
        readonly MediaFoundationReader _reader;
        readonly ISampleProvider _provider;

        public MediaFoundationAudioSource(string filePath)
        {
            _reader = new MediaFoundationReader(filePath);
            Duration = _reader.TotalTime;
            if (Duration <= TimeSpan.Zero) throw new InvalidDataException("无法取得媒体音频时长。");
            var raw = _reader.ToSampleProvider();
            SampleRate = raw.WaveFormat.SampleRate;
            Channels = Math.Max(1, raw.WaveFormat.Channels);
            _provider = raw;
        }

        public TimeSpan Duration { get; }
        public int SampleRate { get; }
        public int Channels { get; }
        public string DecoderName => "Media Foundation";
        public int Read(float[] buffer, int offset, int count) => _provider.Read(buffer, offset, count);
        public void Dispose() => _reader.Dispose();
    }

    public sealed class Mono16kSource : IMediaAudioSource
    {
        readonly IMediaAudioSource _inner;
        readonly ISampleProvider? _resampler;
        readonly SourceSampleProvider? _sourceProvider;
        float[] _scratch = [];

        public Mono16kSource(IMediaAudioSource inner)
        {
            _inner = inner;
            if (inner.SampleRate == 16000 && inner.Channels == 1) return;
            _sourceProvider = new SourceSampleProvider(inner);
            ISampleProvider p = new DownmixToMonoSampleProvider(_sourceProvider);
            if (p.WaveFormat.SampleRate != 16000) p = new WdlResamplingSampleProvider(p, 16000);
            _resampler = p;
        }

        public TimeSpan Duration => _inner.Duration;
        public int SampleRate => 16000;
        public int Channels => 1;
        public string DecoderName => _inner.DecoderName;

        public int Read(float[] buffer, int offset, int count)
        {
            if (_resampler != null) return _resampler.Read(buffer, offset, count);
            return _inner.Read(buffer, offset, count);
        }

        public void Dispose() => _inner.Dispose();

        sealed class SourceSampleProvider : ISampleProvider
        {
            readonly IMediaAudioSource _source;
            public SourceSampleProvider(IMediaAudioSource source)
            {
                _source = source;
                WaveFormat = WaveFormat.CreateIeeeFloatWaveFormat(source.SampleRate, source.Channels);
            }
            public WaveFormat WaveFormat { get; }
            public int Read(float[] buffer, int offset, int count) => _source.Read(buffer, offset, count);
        }

        sealed class DownmixToMonoSampleProvider : ISampleProvider
        {
            readonly ISampleProvider _source;
            readonly int _channels;
            float[] _scratch = [];
            public DownmixToMonoSampleProvider(ISampleProvider source)
            {
                _source = source;
                _channels = Math.Max(1, source.WaveFormat.Channels);
                WaveFormat = WaveFormat.CreateIeeeFloatWaveFormat(source.WaveFormat.SampleRate, 1);
            }
            public WaveFormat WaveFormat { get; }
            public int Read(float[] buffer, int offset, int count)
            {
                if (_channels == 1) return _source.Read(buffer, offset, count);
                var needed = count * _channels;
                if (_scratch.Length < needed) _scratch = new float[needed];
                var read = _source.Read(_scratch, 0, needed);
                var frames = read / _channels;
                for (var f = 0; f < frames; f++)
                {
                    double sum = 0;
                    var b = f * _channels;
                    for (var c = 0; c < _channels; c++) sum += _scratch[b + c];
                    buffer[offset + f] = (float)(sum / _channels);
                }
                return frames;
            }
        }
    }

    sealed class FfmpegAudioSource : IMediaAudioSource
    {
        readonly Process _process;
        readonly Stream _stdout;
        readonly byte[] _bytes = new byte[128 * 1024];
        readonly byte[] _carry = new byte[4];
        int _carryCount;
        bool _eof;

        public FfmpegAudioSource(string filePath, FfmpegManager ffmpeg)
        {
            Duration = ProbeDuration(filePath, ffmpeg.FfprobePath);
            if (Duration <= TimeSpan.Zero) throw new InvalidDataException("ffprobe 无法取得媒体时长。");
            SampleRate = 16000;
            Channels = 1;
            var psi = new ProcessStartInfo(ffmpeg.FfmpegPath)
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            psi.ArgumentList.Add("-v"); psi.ArgumentList.Add("error");
            psi.ArgumentList.Add("-i"); psi.ArgumentList.Add(filePath);
            psi.ArgumentList.Add("-vn");
            psi.ArgumentList.Add("-ac"); psi.ArgumentList.Add("1");
            psi.ArgumentList.Add("-ar"); psi.ArgumentList.Add("16000");
            psi.ArgumentList.Add("-f"); psi.ArgumentList.Add("f32le");
            psi.ArgumentList.Add("pipe:1");
            _process = Process.Start(psi) ?? throw new InvalidOperationException("无法启动 ffmpeg.exe。");
            _process.ErrorDataReceived += (_, _) => { };
            _process.BeginErrorReadLine();
            _stdout = _process.StandardOutput.BaseStream;
        }

        public TimeSpan Duration { get; }
        public int SampleRate { get; }
        public int Channels { get; }
        public string DecoderName => "FFmpeg";

        public int Read(float[] buffer, int offset, int count)
        {
            if (_eof || count <= 0) return 0;
            var written = 0;
            while (written < count)
            {
                if (_carryCount == 4)
                {
                    buffer[offset + written++] = BitConverter.ToSingle(_carry, 0);
                    _carryCount = 0;
                    continue;
                }

                var wantBytes = Math.Min(_bytes.Length, (count - written) * 4);
                var read = _stdout.Read(_bytes, 0, wantBytes);
                if (read <= 0)
                {
                    _eof = true;
                    break;
                }

                var idx = 0;
                if (_carryCount > 0)
                {
                    var need = 4 - _carryCount;
                    var take = Math.Min(need, read);
                    Array.Copy(_bytes, 0, _carry, _carryCount, take);
                    _carryCount += take;
                    idx += take;
                    if (_carryCount == 4 && written < count)
                    {
                        buffer[offset + written++] = BitConverter.ToSingle(_carry, 0);
                        _carryCount = 0;
                    }
                }

                var whole = (read - idx) / 4;
                whole = Math.Min(whole, count - written);
                if (whole > 0)
                {
                    Buffer.BlockCopy(_bytes, idx, buffer, (offset + written) * sizeof(float), whole * 4);
                    written += whole;
                    idx += whole * 4;
                }

                var remain = read - idx;
                if (remain > 0)
                {
                    Array.Copy(_bytes, idx, _carry, 0, remain);
                    _carryCount = remain;
                }
            }
            return written;
        }

        public void Dispose()
        {
            try { _stdout.Dispose(); } catch { }
            try { if (!_process.HasExited) _process.Kill(true); } catch { }
            try { _process.WaitForExit(500); } catch { }
            _process.Dispose();
        }

        static TimeSpan ProbeDuration(string filePath, string ffprobePath)
        {
            var psi = new ProcessStartInfo(ffprobePath)
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            psi.ArgumentList.Add("-v"); psi.ArgumentList.Add("error");
            psi.ArgumentList.Add("-show_entries"); psi.ArgumentList.Add("format=duration");
            psi.ArgumentList.Add("-of"); psi.ArgumentList.Add("default=noprint_wrappers=1:nokey=1");
            psi.ArgumentList.Add(filePath);
            using var p = Process.Start(psi) ?? throw new InvalidOperationException("无法启动 ffprobe.exe。");
            var text = p.StandardOutput.ReadToEnd();
            var error = p.StandardError.ReadToEnd();
            p.WaitForExit(15000);
            if (p.ExitCode != 0) throw new InvalidDataException("ffprobe 解析失败：" + error.Trim());
            return double.TryParse(text.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out var sec)
                ? TimeSpan.FromSeconds(sec)
                : TimeSpan.Zero;
        }
    }
}
