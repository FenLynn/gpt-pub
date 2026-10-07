package com.local.ringtonecutter

import android.content.Context
import android.net.Uri
import com.arthenica.ffmpegkit.FFmpegKit
import com.arthenica.ffmpegkit.ReturnCode
import java.io.File
import java.util.Locale

object MediaEngine {
    data class Result(val success: Boolean, val detail: String = "")

    fun copyUriToCache(context: Context, uri: Uri, sourceName: String): File {
        val ext = sourceName.substringAfterLast('.', "mp4").take(8).ifBlank { "mp4" }
        val target = File(context.cacheDir, "input_" + System.currentTimeMillis() + "." + ext)
        context.contentResolver.openInputStream(uri).use { input ->
            requireNotNull(input) { "无法读取视频" }
            target.outputStream().use { output -> input.copyTo(output) }
        }
        return target
    }

    fun generateWaveform(input: File, output: File): Result {
        val filter = "[0:a:0]aformat=channel_layouts=mono,showwavespic=s=1200x180:colors=0x202124:scale=sqrt[v]"
        val command = buildString {
            append("-hide_banner -y -i ")
            append(quote(input.absolutePath))
            append(" -filter_complex ")
            append(quote(filter))
            append(" -map ")
            append(quote("[v]"))
            append(" -frames:v 1 ")
            append(quote(output.absolutePath))
        }
        val session = FFmpegKit.execute(command)
        val ok = ReturnCode.isSuccess(session.returnCode) && output.exists() && output.length() > 0
        return if (ok) Result(true) else Result(false, summarize(session.allLogsAsString))
    }

    fun exportMp3(input: File, output: File, start: Double, length: Double): Result {
        val command = buildString {
            append("-hide_banner -y -i ")
            append(quote(input.absolutePath))
            append(" -ss ")
            append(String.format(Locale.US, "%.3f", start))
            append(" -t ")
            append(String.format(Locale.US, "%.3f", length))
            append(" -vn -map 0:a:0 ")
            append("-c:a libmp3lame -b:a 192k ")
            append("-map_metadata -1 ")
            append(quote(output.absolutePath))
        }
        val session = FFmpegKit.execute(command)
        val ok = ReturnCode.isSuccess(session.returnCode) && output.exists() && output.length() > 0
        return if (ok) Result(true) else Result(false, summarize(session.allLogsAsString))
    }

    private fun summarize(logs: String): String {
        val lines = logs.lineSequence()
            .map { it.trim() }
            .filter { it.isNotBlank() }
            .filterNot { it.startsWith("ffmpeg version", ignoreCase = true) }
            .toList()
        val preferred = lines.lastOrNull {
            it.contains("error", ignoreCase = true) ||
                it.contains("invalid", ignoreCase = true) ||
                it.contains("encoder", ignoreCase = true) ||
                it.contains("stream", ignoreCase = true) ||
                it.contains("audio", ignoreCase = true)
        } ?: lines.lastOrNull()
        return preferred?.take(180) ?: "FFmpeg 返回失败，未提供详细日志"
    }

    private fun quote(value: String): String =
        "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""
}
