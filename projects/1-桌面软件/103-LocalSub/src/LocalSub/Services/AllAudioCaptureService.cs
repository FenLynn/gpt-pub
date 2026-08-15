using NAudio.Wave;

namespace LocalSub.Services;

public sealed class AllAudioCaptureService : IDisposable
{
    WasapiLoopbackCapture? _capture;
    public event Action<float>? LevelChanged;

    public void Start()
    {
        if (_capture != null) return;
        _capture = new WasapiLoopbackCapture();
        _capture.DataAvailable += (_, e) =>
        {
            var max = 0f;
            for (var i = 0; i + 3 < e.BytesRecorded; i += 4)
            {
                var sample = BitConverter.ToSingle(e.Buffer, i);
                if (float.IsFinite(sample)) max = Math.Max(max, Math.Abs(sample));
            }
            LevelChanged?.Invoke(Math.Clamp(max, 0, 1));
        };
        _capture.StartRecording();
    }

    public void Stop()
    {
        if (_capture == null) return;
        try { _capture.StopRecording(); } catch { }
        _capture.Dispose(); _capture = null; LevelChanged?.Invoke(0);
    }

    public void Dispose() => Stop();
}
