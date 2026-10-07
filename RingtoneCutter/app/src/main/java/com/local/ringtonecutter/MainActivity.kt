package com.local.ringtonecutter

import android.content.ContentValues
import android.graphics.Color
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.MediaController
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import android.widget.VideoView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import com.arthenica.ffmpegkit.FFmpegKit
import com.arthenica.ffmpegkit.ReturnCode
import com.google.android.material.button.MaterialButton
import com.google.android.material.slider.RangeSlider
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout
import java.io.File
import java.util.Locale

class MainActivity : AppCompatActivity() {
    private lateinit var chooseButton: MaterialButton
    private lateinit var exportButton: MaterialButton
    private lateinit var fileInfo: TextView
    private lateinit var videoView: VideoView
    private lateinit var startTime: TextView
    private lateinit var endTime: TextView
    private lateinit var rangeSlider: RangeSlider
    private lateinit var nameEdit: TextInputEditText
    private lateinit var progressBar: ProgressBar
    private lateinit var statusText: TextView
    private lateinit var trimPanel: LinearLayout

    private var selectedUri: Uri? = null
    private var isExporting = false

    private val pickVideo =
        registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            if (uri != null) loadVideo(uri)
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildUi()

        chooseButton.setOnClickListener {
            if (!isExporting) pickVideo.launch(arrayOf("video/*"))
        }
        exportButton.setOnClickListener {
            if (!isExporting) exportMp3()
        }
        rangeSlider.addOnChangeListener { slider, value, fromUser ->
            if (fromUser) {
                updateTimeLabels(slider)
                videoView.seekTo((value * 1000f).toInt())
            }
        }
    }

    private fun buildUi() {
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            setBackgroundColor(Color.rgb(247, 247, 248))
        }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(22), dp(20), dp(28))
        }
        scroll.addView(
            root,
            ScrollView.LayoutParams(
                ScrollView.LayoutParams.MATCH_PARENT,
                ScrollView.LayoutParams.WRAP_CONTENT
            )
        )

        root.addView(TextView(this).apply {
            text = "铃声剪刀"
            textSize = 28f
            setTextColor(Color.rgb(31, 31, 31))
            setTypeface(typeface, android.graphics.Typeface.BOLD)
        })

        root.addView(TextView(this).apply {
            text = "本地视频 → 选时间 → MP3"
            textSize = 14f
            setTextColor(Color.rgb(105, 105, 110))
        }, lpTop(4))

        chooseButton = MaterialButton(this).apply {
            text = "选择本地视频"
            textSize = 16f
            cornerRadius = dp(14)
            minimumHeight = dp(54)
        }
        root.addView(chooseButton, lpTop(22, dp(54)))

        fileInfo = TextView(this).apply {
            text = "还没有选择视频"
            textSize = 13f
            gravity = Gravity.CENTER
            maxLines = 1
            setTextColor(Color.rgb(105, 105, 110))
        }
        root.addView(fileInfo, lpTop(12))

        videoView = VideoView(this)
        val videoFrame = FrameLayout(this).apply {
            setBackgroundColor(Color.BLACK)
            visibility = View.GONE
            addView(
                videoView,
                FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.MATCH_PARENT
                )
            )
        }
        root.addView(videoFrame, lpTop(18, dp(220)))
        videoView.tag = videoFrame

        trimPanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            visibility = View.GONE
        }
        root.addView(trimPanel, lpTop(22))

        val times = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        startTime = TextView(this).apply {
            text = "00:00.0"
            textSize = 15f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
        }
        val hint = TextView(this).apply {
            text = "拖动两端选择范围"
            textSize = 12f
            setTextColor(Color.rgb(105, 105, 110))
        }
        endTime = TextView(this).apply {
            text = "00:00.0"
            textSize = 15f
            gravity = Gravity.END
            setTypeface(typeface, android.graphics.Typeface.BOLD)
        }
        times.addView(startTime, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        times.addView(hint)
        times.addView(endTime, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        trimPanel.addView(times)

        rangeSlider = RangeSlider(this).apply {
            valueFrom = 0f
            valueTo = 1f
            values = listOf(0f, 1f)
            setMinSeparationValue(0.1f)
            isTickVisible = false
        }
        trimPanel.addView(rangeSlider, lpTop(4))

        val nameBox = TextInputLayout(this).apply {
            hint = "文件名"
            boxBackgroundMode = TextInputLayout.BOX_BACKGROUND_OUTLINE
            boxCornerRadiusTopStart = dp(14).toFloat()
            boxCornerRadiusTopEnd = dp(14).toFloat()
            boxCornerRadiusBottomStart = dp(14).toFloat()
            boxCornerRadiusBottomEnd = dp(14).toFloat()
        }
        nameEdit = TextInputEditText(this).apply {
            hint = "例如：我的铃声"
            isSingleLine = true
        }
        nameBox.addView(nameEdit)
        trimPanel.addView(nameBox, lpTop(18))

        exportButton = MaterialButton(this).apply {
            text = "导出 MP3"
            textSize = 17f
            cornerRadius = dp(14)
            minimumHeight = dp(56)
        }
        trimPanel.addView(exportButton, lpTop(16, dp(56)))

        progressBar = ProgressBar(
            this,
            null,
            android.R.attr.progressBarStyleHorizontal
        ).apply {
            isIndeterminate = true
            visibility = View.GONE
        }
        trimPanel.addView(progressBar, lpTop(8, dp(4)))

        statusText = TextView(this).apply {
            text = "保存位置：系统 Ringtones"
            textSize = 12f
            gravity = Gravity.CENTER
            setTextColor(Color.rgb(105, 105, 110))
        }
        trimPanel.addView(statusText, lpTop(10))

        setContentView(scroll)
    }

    private fun loadVideo(uri: Uri) {
        selectedUri = uri
        try {
            contentResolver.takePersistableUriPermission(
                uri,
                android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION
            )
        } catch (_: Exception) {
        }

        val durationMs = readDurationMs(uri)
        if (durationMs <= 0L) {
            toast("无法读取这个视频")
            return
        }

        val name = queryDisplayName(uri) ?: "video"
        val duration = durationMs / 1000f

        fileInfo.text = "$name  ·  \${formatTime(duration)}"
        nameEdit.setText(name.substringBeforeLast('.').take(60))

        (videoView.tag as View).visibility = View.VISIBLE
        trimPanel.visibility = View.VISIBLE

        val controller = MediaController(this)
        controller.setAnchorView(videoView)
        videoView.setMediaController(controller)
        videoView.setVideoURI(uri)
        videoView.setOnPreparedListener { player ->
            player.isLooping = false
            videoView.seekTo(0)
        }

        rangeSlider.valueFrom = 0f
        rangeSlider.valueTo = duration.coerceAtLeast(0.1f)
        rangeSlider.values = listOf(0f, duration.coerceAtLeast(0.1f))
        rangeSlider.setMinSeparationValue(0.1f)
        updateTimeLabels(rangeSlider)
        statusText.text = "保存位置：系统 Ringtones"
    }

    private fun updateTimeLabels(slider: RangeSlider) {
        val v = slider.values.sorted()
        startTime.text = formatTime(v[0])
        endTime.text = formatTime(v[1])
    }

    private fun exportMp3() {
        val uri = selectedUri ?: run {
            toast("请先选择一个视频")
            return
        }

        val v = rangeSlider.values.sorted()
        val start = v[0].toDouble()
        val end = v[1].toDouble()
        val length = end - start
        if (length < 0.1) {
            toast("选择的片段太短")
            return
        }

        val safeName = sanitizeFileName(
            nameEdit.text?.toString().orEmpty().trim().ifBlank { "我的铃声" }
        )
        setExporting(true, "正在提取音频…")

        Thread {
            var input: File? = null
            var output: File? = null
            try {
                input = copyUriToCache(uri)
                output = File(cacheDir, "ringtone_\${System.currentTimeMillis()}.mp3")

                val cmd = buildString {
                    append("-hide_banner -y ")
                    append("-ss \${sec(start)} ")
                    append("-i \${quote(input.absolutePath)} ")
                    append("-t \${sec(length)} ")
                    append("-vn -map 0:a:0? ")
                    append("-c:a libmp3lame -q:a 2 ")
                    append("-map_metadata -1 ")
                    append(quote(output.absolutePath))
                }

                val inputFile = input
                val outputFile = output
                FFmpegKit.executeAsync(cmd) { session ->
                    try {
                        if (
                            ReturnCode.isSuccess(session.returnCode) &&
                            outputFile.exists() &&
                            outputFile.length() > 0
                        ) {
                            val saved = saveToRingtones(outputFile, "$safeName.mp3")
                            runOnUiThread {
                                setExporting(false, "已保存：Ringtones/$saved")
                                toast("MP3 已保存")
                            }
                        } else {
                            runOnUiThread {
                                setExporting(false, "提取失败：视频可能没有音轨")
                            }
                        }
                    } catch (e: Exception) {
                        runOnUiThread {
                            setExporting(false, "保存失败：\${e.message ?: "未知错误"}")
                        }
                    } finally {
                        inputFile.delete()
                        outputFile.delete()
                    }
                }
            } catch (e: Exception) {
                input?.delete()
                output?.delete()
                runOnUiThread {
                    setExporting(false, "处理失败：\${e.message ?: "未知错误"}")
                }
            }
        }.start()
    }

    private fun copyUriToCache(uri: Uri): File {
        val sourceName = queryDisplayName(uri) ?: "input.mp4"
        val ext = sourceName.substringAfterLast('.', "mp4").take(8).ifBlank { "mp4" }
        val target = File(cacheDir, "input_\${System.currentTimeMillis()}.$ext")
        contentResolver.openInputStream(uri).use { input ->
            requireNotNull(input) { "无法读取视频" }
            target.outputStream().use { output -> input.copyTo(output) }
        }
        return target
    }

    private fun saveToRingtones(source: File, requestedName: String): String {
        val name = uniqueName(requestedName)
        val values = ContentValues().apply {
            put(MediaStore.Audio.Media.DISPLAY_NAME, name)
            put(MediaStore.Audio.Media.MIME_TYPE, "audio/mpeg")
            put(MediaStore.Audio.Media.RELATIVE_PATH, Environment.DIRECTORY_RINGTONES)
            put(MediaStore.Audio.Media.IS_RINGTONE, 1)
            put(MediaStore.Audio.Media.IS_MUSIC, 1)
            put(MediaStore.Audio.Media.IS_PENDING, 1)
        }

        val collection =
            MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        val item = requireNotNull(contentResolver.insert(collection, values)) {
            "无法创建铃声文件"
        }

        try {
            contentResolver.openOutputStream(item, "w").use { out ->
                requireNotNull(out) { "无法写入铃声文件" }
                source.inputStream().use { input -> input.copyTo(out) }
            }
            val done = ContentValues().apply {
                put(MediaStore.Audio.Media.IS_PENDING, 0)
            }
            contentResolver.update(item, done, null, null)
            return name
        } catch (e: Exception) {
            contentResolver.delete(item, null, null)
            throw e
        }
    }

    private fun uniqueName(requested: String): String {
        val stem = requested.substringBeforeLast('.')
        val ext = requested.substringAfterLast('.', "mp3")
        val collection =
            MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)

        var candidate = requested
        var i = 1
        while (true) {
            val exists = contentResolver.query(
                collection,
                arrayOf(MediaStore.Audio.Media._ID),
                "\${MediaStore.Audio.Media.DISPLAY_NAME}=? AND \${MediaStore.Audio.Media.RELATIVE_PATH}=?",
                arrayOf(candidate, "\${Environment.DIRECTORY_RINGTONES}/"),
                null
            )?.use { it.moveToFirst() } ?: false

            if (!exists) return candidate
            candidate = "$stem ($i).$ext"
            i++
        }
    }

    private fun readDurationMs(uri: Uri): Long {
        val r = MediaMetadataRetriever()
        return try {
            r.setDataSource(this, uri)
            r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
                ?.toLongOrNull() ?: 0L
        } finally {
            r.release()
        }
    }

    private fun queryDisplayName(uri: Uri): String? =
        contentResolver.query(
            uri,
            arrayOf(OpenableColumns.DISPLAY_NAME),
            null,
            null,
            null
        )?.use { c ->
            if (c.moveToFirst()) c.getString(0) else null
        }

    private fun setExporting(value: Boolean, text: String) {
        isExporting = value
        chooseButton.isEnabled = !value
        exportButton.isEnabled = !value
        rangeSlider.isEnabled = !value
        nameEdit.isEnabled = !value
        progressBar.visibility = if (value) View.VISIBLE else View.GONE
        statusText.text = text
    }

    private fun sanitizeFileName(name: String): String =
        name.replace(Regex("[\\\\/:*?\"<>|]"), "_")
            .replace(Regex("\\s+"), " ")
            .trim('.', ' ')
            .take(80)
            .ifBlank { "我的铃声" }

    private fun formatTime(seconds: Float): String {
        val t = (seconds * 10).toInt().coerceAtLeast(0)
        return String.format(
            Locale.US,
            "%02d:%02d.%d",
            t / 600,
            (t / 10) % 60,
            t % 10
        )
    }

    private fun sec(v: Double): String =
        String.format(Locale.US, "%.3f", v)

    private fun quote(path: String): String =
        "\"\${path.replace("\\", "\\\\").replace("\"", "\\\"")}\""

    private fun dp(v: Int): Int =
        (v * resources.displayMetrics.density + 0.5f).toInt()

    private fun lpTop(top: Int, height: Int = LinearLayout.LayoutParams.WRAP_CONTENT) =
        LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            height
        ).apply {
            topMargin = dp(top)
        }

    private fun toast(msg: String) =
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
}
