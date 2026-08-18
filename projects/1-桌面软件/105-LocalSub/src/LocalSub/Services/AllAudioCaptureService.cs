using NAudio.Wave;

namespace LocalSub.Services;

public sealed class AllAudioCaptureService : IDisposable
{
    static readonly Guid PcmSubFormat = new("00000001-0000-0010-8000-00AA00389B71");
    static readonly Guid FloatSubFormat = new("00000003-0000-0010-8000-00AA00389B71");

    WasapiLoopbackCapture? _capture;
    StreamingLinearResampler? _resampler;
    public event Action<float>? LevelChanged;
    public event Action<float[]>? SamplesAvailable;

    public void Start()
    {
        if (_capture != null) return;
        _capture = new WasapiLoopbackCapture();
        var format = _capture.WaveFormat;
        _resampler = new StreamingLinearResampler(format.SampleRate, 16000);
        _capture.DataAvailable += (_, e) =>
        {
            var mono = DecodeToMono(e.Buffer, e.BytesRecorded, format, out var peak);
            LevelChanged?.Invoke(peak);
            if (mono.Length == 0) return;
            var samples16k = _resampler.Process(mono);
            if (samples16k.Length > 0) SamplesAvailable?.Invoke(samples16k);
        };
        _capture.StartRecording();
    }

    static float[] DecodeToMono(byte[] buffer, int bytesRecorded, WaveFormat format, out float peak)
    {
        peak = 0;
        var channels = Math.Max(1, format.Channels);
        var bytesPerSample = Math.Max(1, format.BitsPerSample / 8);
        var frameBytes = bytesPerSample * channels;
        if (frameBytes <= 0 || bytesRecorded < frameBytes) return [];

        var isFloat = format.Encoding == WaveFormatEncoding.IeeeFloat ||
                      format is WaveFormatExtensible extFloat && extFloat.SubFormat == FloatSubFormat;
        var isPcm = format.Encoding == WaveFormatEncoding.Pcm ||
                    format is WaveFormatExtensible extPcm && extPcm.SubFormat == PcmSubFormat;
        if (!isFloat && !isPcm) return [];

        var frames = bytesRecorded / frameBytes;
        var mono = new float[frames];
        for (var f = 0; f < frames; f++)
        {
            double sum = 0;
            for (var c = 0; c < channels; c++)
            {
                var offset = f * frameBytes + c * bytesPerSample;
                float sample;
                if (isFloat && format.BitsPerSample == 32)
                {
                    sample = BitConverter.ToSingle(buffer, offset);
                    if (!float.IsFinite(sample)) sample = 0;
                }
                else if (isPcm && format.BitsPerSample == 16)
                {
                    sample = BitConverter.ToInt16(buffer, offset) / 32768f;
                }
                else if (isPcm && format.BitsPerSample == 24)
                {
                    var value = buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
                    if ((value & 0x800000) != 0) value |= unchecked((int)0xFF000000);
                    sample = value / 8388608f;
                }
                else if (isPcm && format.BitsPerSample == 32)
                {
                    sample = (float)(BitConverter.ToInt32(buffer, offset) / 2147483648.0);
                }
                else
                {
                    return [];
                }
                sum += sample;
            }
            var valueMono = (float)Math.Clamp(sum / channels, -1.0, 1.0);
            mono[f] = valueMono;
            peak = Math.Max(peak, Math.Abs(valueMono));
        }
        return mono;
    }

    public void Stop()
    {
        if (_capture == null) return;
        try { _capture.StopRecording(); } catch { }
        _capture.Dispose();
        _capture = null;
        _resampler = null;
        LevelChanged?.Invoke(0);
    }

    public void Dispose() => Stop();

    sealed class StreamingLinearResampler
    {
        readonly double _step;
        long _sourceIndex;
        double _nextOutputPosition;
        bool _hasPrevious;
        float _previous;

        public StreamingLinearResampler(int sourceRate, int targetRate)
        {
            if (sourceRate <= 0 || targetRate <= 0) throw new ArgumentOutOfRangeException();
            _step = sourceRate / (double)targetRate;
        }

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
                var intervalStart = _sourceIndex - 1.0;
                while (_nextOutputPosition <= _sourceIndex)
                {
                    var t = Math.Clamp(_nextOutputPosition - intervalStart, 0, 1);
                    output.Add((float)(_previous + (current - _previous) * t));
                    _nextOutputPosition += _step;
                }
                _previous = current;
            }
            return output.ToArray();
        }
    }
}
