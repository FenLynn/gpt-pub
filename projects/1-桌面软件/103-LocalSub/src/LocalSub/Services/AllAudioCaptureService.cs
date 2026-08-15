using NAudio.Wave;

namespace LocalSub.Services;

public sealed class AllAudioCaptureService : IDisposable
{
    static readonly Guid PcmSubFormat = new("00000001-0000-0010-8000-00AA00389B71");
    static readonly Guid FloatSubFormat = new("00000003-0000-0010-8000-00AA00389B71");

    WasapiLoopbackCapture? _capture;
    public event Action<float>? LevelChanged;

    public void Start()
    {
        if (_capture != null) return;
        _capture = new WasapiLoopbackCapture();
        var format = _capture.WaveFormat;
        _capture.DataAvailable += (_, e) => LevelChanged?.Invoke(CalculatePeak(e.Buffer, e.BytesRecorded, format));
        _capture.StartRecording();
    }

    static float CalculatePeak(byte[] buffer, int bytesRecorded, WaveFormat format)
    {
        var isFloat = format.Encoding == WaveFormatEncoding.IeeeFloat ||
                      format is WaveFormatExtensible extFloat && extFloat.SubFormat == FloatSubFormat;
        var isPcm = format.Encoding == WaveFormatEncoding.Pcm ||
                    format is WaveFormatExtensible extPcm && extPcm.SubFormat == PcmSubFormat;

        var max = 0f;
        if (isFloat && format.BitsPerSample == 32)
        {
            for (var i = 0; i + 3 < bytesRecorded; i += 4)
            {
                var sample = BitConverter.ToSingle(buffer, i);
                if (float.IsFinite(sample)) max = Math.Max(max, Math.Abs(sample));
            }
        }
        else if (isPcm && format.BitsPerSample == 16)
        {
            for (var i = 0; i + 1 < bytesRecorded; i += 2)
                max = Math.Max(max, Math.Abs(BitConverter.ToInt16(buffer, i) / 32768f));
        }
        else if (isPcm && format.BitsPerSample == 24)
        {
            for (var i = 0; i + 2 < bytesRecorded; i += 3)
            {
                var value = buffer[i] | (buffer[i + 1] << 8) | (buffer[i + 2] << 16);
                if ((value & 0x800000) != 0) value |= unchecked((int)0xFF000000);
                max = Math.Max(max, Math.Abs(value / 8388608f));
            }
        }
        else if (isPcm && format.BitsPerSample == 32)
        {
            for (var i = 0; i + 3 < bytesRecorded; i += 4)
                max = Math.Max(max, Math.Abs(BitConverter.ToInt32(buffer, i) / 2147483648f));
        }

        return Math.Clamp(max, 0, 1);
    }

    public void Stop()
    {
        if (_capture == null) return;
        try { _capture.StopRecording(); } catch { }
        _capture.Dispose();
        _capture = null;
        LevelChanged?.Invoke(0);
    }

    public void Dispose() => Stop();
}
