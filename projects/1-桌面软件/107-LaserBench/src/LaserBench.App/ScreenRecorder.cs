using System.Drawing.Imaging;

namespace LaserBench;

internal sealed class ScreenRecorder : IDisposable
{
    private readonly Control _source;
    private readonly System.Windows.Forms.Timer _timer;
    private AviMjpegWriter? _writer;
    private string? _partialPath;
    private DateTime _startedAt;
    private string _label = string.Empty;
    private Func<Stream, Task>? _previewSource;
    private bool _frameBusy;

    public bool IsRecording => _writer is not null;
    public string? LastSavedPath { get; private set; }

    public ScreenRecorder(Control source)
    {
        _source = source;
        _timer = new System.Windows.Forms.Timer { Interval = 200 };
        _timer.Tick += async (_, _) => await CaptureTickAsync();
    }

    public void SetPreviewSource(Func<Stream, Task> previewSource)
        => _previewSource = previewSource;

    public void Start(string label)
    {
        if (IsRecording) return;
        Directory.CreateDirectory(AppPaths.VideoDir);
        _startedAt = DateTime.Now;
        _label = label;
        _partialPath = Path.Combine(AppPaths.VideoDir, $".{Guid.NewGuid():N}.avi.partial");

        var size = GetRecordingSize(_source.ClientSize);
        _writer = new AviMjpegWriter(_partialPath, size.Width, size.Height, 5);
        _timer.Start();
        _ = CaptureTickAsync();
    }

    public string? Stop()
    {
        if (_writer is null || _partialPath is null) return LastSavedPath;
        _timer.Stop();
        try
        {
            _writer.Dispose();
            var baseName = SafeFile.ComposeBaseName(_startedAt, "screen", _label);
            LastSavedPath = SafeFile.MovePartialToUnique(_partialPath, AppPaths.VideoDir, baseName, ".avi");
            return LastSavedPath;
        }
        finally
        {
            _writer = null;
            _partialPath = null;
        }
    }

    private async Task CaptureTickAsync()
    {
        if (_frameBusy || _writer is null || _source.Width <= 0 || _source.Height <= 0) return;
        _frameBusy = true;
        var writer = _writer;
        try
        {
            Bitmap original;
            if (_previewSource is not null)
            {
                using var png = new MemoryStream();
                await _previewSource(png);
                if (!ReferenceEquals(_writer, writer) || _writer is null) return;
                png.Position = 0;
                using var decoded = new Bitmap(png);
                original = new Bitmap(decoded);
            }
            else
            {
                original = new Bitmap(_source.ClientSize.Width, _source.ClientSize.Height, PixelFormat.Format24bppRgb);
                _source.DrawToBitmap(original, new Rectangle(Point.Empty, _source.ClientSize));
            }

            using (original)
            {
                if (!ReferenceEquals(_writer, writer) || _writer is null) return;
                var targetSize = new Size(writer.Width, writer.Height);
                using var frame = new Bitmap(targetSize.Width, targetSize.Height, PixelFormat.Format24bppRgb);
                using (var g = Graphics.FromImage(frame))
                {
                    g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBilinear;
                    g.DrawImage(original, new Rectangle(Point.Empty, targetSize));
                }
                writer.WriteFrame(frame);
            }
        }
        catch
        {
            // Recording is an auxiliary visual log. Measurement acquisition must not be interrupted by a frame failure.
        }
        finally
        {
            _frameBusy = false;
        }
    }

    private static Size GetRecordingSize(Size source)
    {
        if (source.Width <= 0 || source.Height <= 0) return new Size(1280, 720);
        const int maxWidth = 1280;
        const int maxHeight = 720;
        var scale = Math.Min(1.0, Math.Min((double)maxWidth / source.Width, (double)maxHeight / source.Height));
        var width = Math.Max(2, (int)Math.Round(source.Width * scale));
        var height = Math.Max(2, (int)Math.Round(source.Height * scale));
        if ((width & 1) == 1) width--;
        if ((height & 1) == 1) height--;
        return new Size(width, height);
    }

    public void Dispose()
    {
        try { Stop(); } catch { }
        _timer.Dispose();
    }
}

internal sealed class AviMjpegWriter : IDisposable
{
    private readonly FileStream _stream;
    private readonly BinaryWriter _writer;
    private readonly int _fps;
    private readonly List<(uint Offset, uint Size)> _index = new();
    private readonly long _riffSizePosition;
    private readonly long _hdrlSizePosition;
    private readonly long _strlSizePosition;
    private readonly long _moviSizePosition;
    private readonly long _moviDataStart;
    private readonly long _totalFramesPosition;
    private readonly long _streamLengthPosition;
    private bool _closed;

    public int Width { get; }
    public int Height { get; }

    public AviMjpegWriter(string path, int width, int height, int fps)
    {
        Width = width;
        Height = height;
        _fps = fps;
        _stream = new FileStream(path, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.Read);
        _writer = new BinaryWriter(_stream);

        WriteFourCc("RIFF");
        _riffSizePosition = _stream.Position;
        _writer.Write(0u);
        WriteFourCc("AVI ");

        WriteFourCc("LIST");
        _hdrlSizePosition = _stream.Position;
        _writer.Write(0u);
        WriteFourCc("hdrl");

        WriteFourCc("avih");
        _writer.Write(56u);
        _writer.Write((uint)(1_000_000 / Math.Max(1, fps)));
        _writer.Write(0u);
        _writer.Write(0u);
        _writer.Write(0x10u);
        _totalFramesPosition = _stream.Position;
        _writer.Write(0u);
        _writer.Write(0u);
        _writer.Write(1u);
        _writer.Write((uint)(width * height * 3));
        _writer.Write((uint)width);
        _writer.Write((uint)height);
        for (var i = 0; i < 4; i++) _writer.Write(0u);

        WriteFourCc("LIST");
        _strlSizePosition = _stream.Position;
        _writer.Write(0u);
        WriteFourCc("strl");

        WriteFourCc("strh");
        _writer.Write(56u);
        WriteFourCc("vids");
        WriteFourCc("MJPG");
        _writer.Write(0u);
        _writer.Write((ushort)0);
        _writer.Write((ushort)0);
        _writer.Write(0u);
        _writer.Write(1u);
        _writer.Write((uint)fps);
        _writer.Write(0u);
        _streamLengthPosition = _stream.Position;
        _writer.Write(0u);
        _writer.Write((uint)(width * height * 3));
        _writer.Write(0xFFFFFFFFu);
        _writer.Write(0u);
        _writer.Write((short)0);
        _writer.Write((short)0);
        _writer.Write((short)Math.Min(short.MaxValue, width));
        _writer.Write((short)Math.Min(short.MaxValue, height));

        WriteFourCc("strf");
        _writer.Write(40u);
        _writer.Write(40u);
        _writer.Write(width);
        _writer.Write(height);
        _writer.Write((ushort)1);
        _writer.Write((ushort)24);
        WriteFourCc("MJPG");
        _writer.Write((uint)(width * height * 3));
        _writer.Write(0);
        _writer.Write(0);
        _writer.Write(0u);
        _writer.Write(0u);

        PatchListSize(_strlSizePosition);
        PatchListSize(_hdrlSizePosition);

        WriteFourCc("LIST");
        _moviSizePosition = _stream.Position;
        _writer.Write(0u);
        WriteFourCc("movi");
        _moviDataStart = _stream.Position;
    }

    public void WriteFrame(Bitmap bitmap)
    {
        if (_closed) throw new ObjectDisposedException(nameof(AviMjpegWriter));
        using var memory = new MemoryStream();
        var codec = ImageCodecInfo.GetImageEncoders().First(x => x.MimeType.Equals("image/jpeg", StringComparison.OrdinalIgnoreCase));
        using (var parameters = new EncoderParameters(1))
        {
            parameters.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 52L);
            bitmap.Save(memory, codec, parameters);
        }

        var bytes = memory.ToArray();
        var chunkStart = _stream.Position;
        WriteFourCc("00dc");
        _writer.Write((uint)bytes.Length);
        _writer.Write(bytes);
        if ((bytes.Length & 1) == 1) _writer.Write((byte)0);

        _index.Add(((uint)(chunkStart - _moviDataStart), (uint)bytes.Length));
    }

    public void Dispose()
    {
        if (_closed) return;
        _closed = true;

        PatchListSize(_moviSizePosition);

        WriteFourCc("idx1");
        _writer.Write((uint)(_index.Count * 16));
        foreach (var item in _index)
        {
            WriteFourCc("00dc");
            _writer.Write(0x10u);
            _writer.Write(item.Offset);
            _writer.Write(item.Size);
        }

        var end = _stream.Position;
        PatchUInt32(_totalFramesPosition, (uint)_index.Count);
        PatchUInt32(_streamLengthPosition, (uint)_index.Count);
        PatchUInt32(_riffSizePosition, (uint)(end - 8));
        _stream.Position = end;
        _writer.Flush();
        _stream.Flush(true);
        _writer.Dispose();
        _stream.Dispose();
    }

    private void PatchListSize(long sizePosition)
    {
        var end = _stream.Position;
        PatchUInt32(sizePosition, (uint)(end - (sizePosition + 4)));
        _stream.Position = end;
    }

    private void PatchUInt32(long position, uint value)
    {
        var current = _stream.Position;
        _stream.Position = position;
        _writer.Write(value);
        _stream.Position = current;
    }

    private void WriteFourCc(string value)
    {
        if (value.Length != 4) throw new ArgumentException("FOURCC must contain four characters.", nameof(value));
        _writer.Write(System.Text.Encoding.ASCII.GetBytes(value));
    }
}
