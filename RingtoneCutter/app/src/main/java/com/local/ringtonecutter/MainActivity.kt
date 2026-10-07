package com.local.ringtonecutter

import android.content.ColorStateList
import android.content.ContentValues
import android.content.Context
import android.graphics.BitmapFactory
import android.graphics.Color
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.inputmethod.InputMethodManager
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import android.widget.VideoView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import com.arthenica.ffmpegkit.FFmpegKit
import com.arthenica.ffmpegkit.FFmpegKitConfig
import com.arthenica.ffmpegkit.ReturnCode
import com.google.android.material.button.MaterialButton
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.slider.RangeSlider
import com.google.android.material.switchmaterial.SwitchMaterial
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.max
import kotlin.math.min

class MainActivity : AppCompatActivity() {
    companion object {
        private const val OUTRO_SECONDS = 3.0f
    }

    private lateinit var mainScroll: ScrollView
    private lateinit var chooseButton: MaterialButton
    private lateinit var exportButton: MaterialButton
    private lateinit var previewButton: MaterialButton
    private lateinit var fullButton: MaterialButton
    private lateinit var nameButton: MaterialButton
    private lateinit var fileInfo: TextView
    private lateinit var videoFrame: FrameLayout
    private lateinit var videoView: VideoView
    private lateinit var previewTime: TextView
    private lateinit var trimPanel: LinearLayout
    private lateinit var autoOutroSwitch: SwitchMaterial
    private lateinit var waveformFrame: FrameLayout
    private lateinit var waveformImage: ImageView
    private lateinit var waveformHint: TextView
    private lateinit var playheadView: View
    private lateinit var rangeSlider: RangeSlider
    private lateinit var startTime: TextView
    private lateinit var endTime: TextView
    private lateinit var selectedTime: TextView
    private lateinit var progressBar: ProgressBar
    private lateinit var statusText: TextView

    private var selectedUri: Uri? = null
    private var currentDuration = 0f
    private var outputName = "我的铃声"
    private var workingInput: File? = null
    private var waveformFile: File? = null
    private var loadGeneration = 0
    private var isExporting = false
    private var previewStartMs = 0
    private var previewEndMs = 0

    private val previewHandler = Handler(Looper.getMainLooper())
    private val previewTicker = object : Runnable {
        override fun run() {
            if (!::videoView.isInitialized) return
            val position = videoView.currentPosition.coerceAtLeast(0)
            previewTime.text = "当前播放  " + formatTime(position / 1000f)
            setPlayhead(position / 1000f)

            if (position >= previewEndMs - 60) {
                stopSelectionPreview()
            } else {
                previewHandler.postDelayed(this, 80)
            }
        }
    }

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

        previewButton.setOnClickListener {
            if (!isExporting) toggleSelectionPreview()
        }

        fullButton.setOnClickListener {
            if (currentDuration > 0f && !isExporting) {
                stopSelectionPreview()
                autoOutroSwitch.isChecked = false
                rangeSlider.values = listOf(0f, currentDuration)
                updateSelectionUi()
                seekPreview(0f)
                statusText.text = "已恢复完整视频范围"
            }
        }

        nameButton.setOnClickListener {
            if (!isExporting) showRenameDialog()
        }

        autoOutroSwitch.setOnCheckedChangeListener { _, checked ->
            getSharedPreferences("settings", MODE_PRIVATE)
                .edit()
                .putBoolean("auto_douyin_outro", checked)
                .apply()

            if (currentDuration > 0f && !isExporting) {
                stopSelectionPreview()
                if (checked) {
                    applyAutoOutroTrim()
                } else {
                    val start = rangeSlider.values.minOrNull() ?: 0f
                    rangeSlider.values = listOf(min(start, currentDuration - 0.1f), currentDuration)
                    updateSelectionUi()
                    statusText.text = "已保留完整片尾"
                }
            }
        }

        rangeSlider.addOnChangeListener { _, value, fromUser ->
            if (fromUser) {
                stopSelectionPreview()
                updateSelectionUi()
                seekPreview(value)
            }
        }

        videoView.setOnClickListener {
            if (selectedUri != null && !isExporting) toggleSelectionPreview()
        }
    }

    private fun buildUi() {
        val prefs = getSharedPreferences("settings", MODE_PRIVATE)

        mainScroll = ScrollView(this).apply {
            isFillViewport = true
            setBackgroundColor(Color.rgb(247, 247, 248))
        }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(18), dp(18), dp(30))
        }
        mainScroll.addView(
            root,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT
            )
        )

        root.addView(TextView(this).apply {
            text = "铃声剪刀"
            textSize = 27f
            setTextColor(Color.rgb(31, 31, 31))
            setTypeface(typeface, android.graphics.Typeface.BOLD)
        })

        root.addView(TextView(this).apply {
            text = "本地视频  ·  选片段  ·  导出 MP3"
            textSize = 13f
            setTextColor(Color.rgb(112, 112, 118))
        }, lpTop(2))

        chooseButton = MaterialButton(this).apply {
            text = "选择本地视频"
            textSize = 16f
            cornerRadius = dp(14)
            minimumHeight = dp(52)
        }
        root.addView(chooseButton, lpTop(18, dp(52)))

        fileInfo = TextView(this).apply {
            text = "还没有选择视频"
            textSize = 13f
            gravity = Gravity.CENTER
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.MIDDLE
            setTextColor(Color.rgb(100, 100, 106))
        }
        root.addView(fileInfo, lpTop(10))

        videoView = VideoView(this)
        previewTime = TextView(this).apply {
            text = "当前预览  00:00.0"
            textSize = 14f
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.argb(185, 0, 0, 0))
            setPadding(dp(12), dp(6), dp(12), dp(6))
        }

        videoFrame = FrameLayout(this).apply {
            setBackgroundColor(Color.BLACK)
            visibility = View.GONE
            addView(
                videoView,
                FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.MATCH_PARENT
                )
            )
            addView(
                previewTime,
                FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.WRAP_CONTENT,
                    FrameLayout.LayoutParams.WRAP_CONTENT,
                    Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
                ).apply {
                    bottomMargin = dp(10)
                }
            )
        }
        root.addView(videoFrame, lpTop(16, dp(230)))

        trimPanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            visibility = View.GONE
        }
        root.addView(trimPanel, lpTop(18))

        autoOutroSwitch = SwitchMaterial(this).apply {
            text = "自动去抖音片尾  ·  最后 3.0 秒"
            textSize = 14f
            setTextColor(Color.rgb(45, 45, 48))
            isChecked = prefs.getBoolean("auto_douyin_outro", true)
        }
        trimPanel.addView(autoOutroSwitch)

        trimPanel.addView(TextView(this).apply {
            text = "只预调结束点，不改原视频；不准时可以直接拖回去"
            textSize = 11.5f
            setTextColor(Color.rgb(125, 125, 132))
        }, lpTop(2))

        waveformImage = ImageView(this).apply {
            scaleType = ImageView.ScaleType.FIT_XY
            setBackgroundColor(Color.WHITE)
            alpha = 0.88f
        }

        waveformHint = TextView(this).apply {
            text = "选择视频后生成音频波形"
            textSize = 12f
            gravity = Gravity.CENTER
            setTextColor(Color.rgb(135, 135, 142))
        }

        rangeSlider = RangeSlider(this).apply {
            valueFrom = 0f
            valueTo = 1f
            values = listOf(0f, 1f)
            setMinSeparationValue(0.1f)
            isTickVisible = false
            setLabelFormatter { formatTime(it) }
        }

        playheadView = View(this).apply {
            setBackgroundColor(Color.rgb(225, 70, 70))
            visibility = View.GONE
            isClickable = false
            isFocusable = false
        }

        waveformFrame = FrameLayout(this).apply {
            setBackgroundColor(Color.WHITE)
            addView(
                waveformImage,
                FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.MATCH_PARENT
                )
            )
            addView(
                waveformHint,
                FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.MATCH_PARENT
                )
            )
            addView(
                rangeSlider,
                FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.WRAP_CONTENT,
                    Gravity.CENTER_VERTICAL
                )
            )
            addView(
                playheadView,
                FrameLayout.LayoutParams(
                    dp(2),
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    Gravity.START
                )
            )
        }
        trimPanel.addView(waveformFrame, lpTop(14, dp(94)))

        val times = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }

        startTime = TextView(this).apply {
            text = "开始  00:00.0"
            textSize = 13f
            setTextColor(Color.rgb(42, 42, 46))
            setTypeface(typeface, android.graphics.Typeface.BOLD)
        }

        selectedTime = TextView(this).apply {
            text = "已选  00:00.0"
            textSize = 12f
            gravity = Gravity.CENTER
            setTextColor(Color.rgb(105, 105, 112))
        }

        endTime = TextView(this).apply {
            text = "结束  00:00.0"
            textSize = 13f
            gravity = Gravity.END
            setTextColor(Color.rgb(42, 42, 46))
            setTypeface(typeface, android.graphics.Typeface.BOLD)
        }

        times.addView(startTime, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        times.addView(selectedTime, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        times.addView(endTime, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        trimPanel.addView(times, lpTop(6))

        val actionRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }

        fullButton = secondaryButton("恢复全长")
        previewButton = secondaryButton("▶ 试听选中")

        actionRow.addView(
            fullButton,
            LinearLayout.LayoutParams(0, dp(44), 1f).apply { marginEnd = dp(5) }
        )
        actionRow.addView(
            previewButton,
            LinearLayout.LayoutParams(0, dp(44), 1f).apply { marginStart = dp(5) }
        )
        trimPanel.addView(actionRow, lpTop(12))

        nameButton = secondaryButton("文件名  我的铃声   ✎").apply {
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.MIDDLE
            setPadding(dp(14), 0, dp(14), 0)
        }
        trimPanel.addView(nameButton, lpTop(12, dp(48)))

        exportButton = MaterialButton(this).apply {
            text = "导出 MP3"
            textSize = 17f
            cornerRadius = dp(14)
            minimumHeight = dp(56)
        }
        trimPanel.addView(exportButton, lpTop(12, dp(56)))

        progressBar = ProgressBar(
            this,
            null,
            android.R.attr.progressBarStyleHorizontal
        ).apply {
            isIndeterminate = true
            visibility = View.GONE
        }
        trimPanel.addView(progressBar, lpTop(6, dp(4)))

        statusText = TextView(this).apply {
            text = "保存位置：系统 Ringtones"
            textSize = 12f
            gravity = Gravity.CENTER
            setTextColor(Color.rgb(110, 110, 116))
            setPadding(dp(4), dp(6), dp(4), dp(6))
        }
        trimPanel.addView(statusText, lpTop(4))

        setContentView(mainScroll)
    }

    private fun secondaryButton(label: String): MaterialButton =
        MaterialButton(this).apply {
            text = label
            textSize = 13f
            cornerRadius = dp(12)
            backgroundTintList = ColorStateList.valueOf(Color.WHITE)
            setTextColor(Color.rgb(45, 45, 48))
            strokeWidth = dp(1)
            strokeColor = ColorStateList.valueOf(Color.rgb(215, 215, 220))
        }

    private fun loadVideo(uri: Uri) {
        stopSelectionPreview()
        loadGeneration += 1
        val generation = loadGeneration

        selectedUri = uri
        cleanupWorkingFiles()

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

        currentDuration = durationMs / 1000f
        val sourceName = queryDisplayName(uri) ?: "video.mp4"
        outputName = makeDefaultOutputName(sourceName)
        updateNameButton()

        fileInfo.text = sourceName + "  ·  " + formatTime(currentDuration)

        videoFrame.visibility = View.VISIBLE
        trimPanel.visibility = View.VISIBLE

        videoView.setMediaController(null)
        videoView.setVideoURI(uri)
        videoView.setOnPreparedListener { player ->
            player.isLooping = false
            videoView.seekTo(0)
        }

        rangeSlider.valueFrom = 0f
        rangeSlider.valueTo = max(currentDuration, 0.1f)
        rangeSlider.setMinSeparationValue(0.1f)

        if (autoOutroSwitch.isChecked && currentDuration > OUTRO_SECONDS + 0.5f) {
            rangeSlider.values = listOf(0f, currentDuration - OUTRO_SECONDS)
            statusText.text = "已自动预剪最后 3.0 秒片尾"
        } else {
            rangeSlider.values = listOf(0f, currentDuration)
            statusText.text = "拖动波形两端选择片段"
        }

        updateSelectionUi()
        previewTime.text = "当前预览  00:00.0"
        playheadView.visibility = View.GONE

        waveformImage.setImageDrawable(null)
        waveformHint.visibility = View.VISIBLE
        waveformHint.text = "正在生成音频波形…"

        prepareWorkingCopyAndWaveform(uri, generation)
    }

    private fun applyAutoOutroTrim() {
        if (currentDuration <= OUTRO_SECONDS + 0.5f) return
        val values = rangeSlider.values.sorted()
        val autoEnd = currentDuration - OUTRO_SECONDS
        val start = min(values[0], max(0f, autoEnd - 0.1f))
        rangeSlider.values = listOf(start, autoEnd)
        updateSelectionUi()
        seekPreview(autoEnd)
        statusText.text = "已自动预剪最后 3.0 秒片尾，可拖动微调"
    }

    private fun updateSelectionUi() {
        if (!::rangeSlider.isInitialized) return
        val values = rangeSlider.values.sorted()
        if (values.size < 2) return

        val start = values[0]
        val end = values[1]
        startTime.text = "开始  " + formatTime(start)
        endTime.text = "结束  " + formatTime(end)
        selectedTime.text = "已选  " + formatTime(max(0f, end - start))
    }

    private fun seekPreview(seconds: Float) {
        if (currentDuration <= 0f) return
        val target = seconds.coerceIn(0f, currentDuration)
        videoView.pause()
        videoView.seekTo((target * 1000f).toInt())
        previewTime.text = "当前预览  " + formatTime(target)
        setPlayhead(target)
    }

    private fun setPlayhead(seconds: Float) {
        if (!::waveformFrame.isInitialized || currentDuration <= 0f) return
        playheadView.visibility = View.VISIBLE

        waveformFrame.post {
            val width = waveformFrame.width
            if (width <= 0) return@post
            val fraction = (seconds / currentDuration).coerceIn(0f, 1f)
            val x = fraction * (width - dp(2))
            playheadView.translationX = x
        }
    }

    private fun toggleSelectionPreview() {
        if (selectedUri == null || currentDuration <= 0f) return

        if (videoView.isPlaying) {
            stopSelectionPreview()
            return
        }

        val values = rangeSlider.values.sorted()
        previewStartMs = (values[0] * 1000f).toInt()
        previewEndMs = (values[1] * 1000f).toInt()

        if (previewEndMs <= previewStartMs + 80) {
            toast("选择的片段太短")
            return
        }

        videoView.seekTo(previewStartMs)
        videoView.start()
        previewButton.text = "Ⅱ  暂停试听"
        previewHandler.removeCallbacks(previewTicker)
        previewHandler.post(previewTicker)
    }

    private fun stopSelectionPreview() {
        previewHandler.removeCallbacks(previewTicker)
        if (::videoView.isInitialized && videoView.isPlaying) {
            videoView.pause()
        }
        if (::previewButton.isInitialized) {
            previewButton.text = "▶ 试听选中"
        }
    }

    private fun prepareWorkingCopyAndWaveform(uri: Uri, generation: Int) {
        Thread {
            var input: File? = null
            var wave: File? = null

            try {
                input = copyUriToCache(uri)
                wave = File(cacheDir, "waveform_" + System.currentTimeMillis() + ".png")

                val filter = "[0:a:0]aformat=channel_layouts=mono,showwavespic=s=1200x180:colors=0x202124:scale=sqrt[v]"
                val command = buildString {
                    append("-hide_banner -y ")
                    append("-i ")
                    append(quote(input.absolutePath))
                    append(" -filter_complex ")
                    append(quote(filter))
                    append(" -map ")
                    append(quote("[v]"))
                    append(" -frames:v 1 ")
                    append(quote(wave.absolutePath))
                }

                val session = FFmpegKit.execute(command)
                val waveOk =
                    ReturnCode.isSuccess(session.returnCode) &&
                    wave.exists() &&
                    wave.length() > 0

                runOnUiThread {
                    if (generation != loadGeneration) {
                        input.delete()
                        wave.delete()
                        return@runOnUiThread
                    }

                    workingInput = input
                    waveformFile = wave

                    if (waveOk) {
                        val bitmap = BitmapFactory.decodeFile(wave.absolutePath)
                        if (bitmap != null) {
                            waveformImage.setImageBitmap(bitmap)
                            waveformHint.visibility = View.GONE
                            statusText.text =
                                if (autoOutroSwitch.isChecked) {
                                    "波形已就绪 · 已预剪 3.0 秒片尾"
                                } else {
                                    "波形已就绪 · 拖动两端选择片段"
                                }
                        } else {
                            waveformHint.text = "波形显示失败，不影响试听与导出"
                        }
                    } else {
                        waveformHint.text = "波形生成失败，不影响试听与导出"
                    }
                }
            } catch (e: Exception) {
                input?.delete()
                wave?.delete()
                runOnUiThread {
                    if (generation == loadGeneration) {
                        waveformHint.text = "波形暂不可用，不影响试听与导出"
                        statusText.text = "视频已加载，可以继续剪辑"
                    }
                }
            }
        }.start()
    }

    private fun showRenameDialog() {
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(22), dp(6), dp(22), 0)
        }

        val inputLayout = TextInputLayout(this).apply {
            hint = "MP3 文件名"
            boxBackgroundMode = TextInputLayout.BOX_BACKGROUND_OUTLINE
        }

        val edit = TextInputEditText(this).apply {
            setText(outputName)
            selectAll()
            isSingleLine = true
            imeOptions = android.view.inputmethod.EditorInfo.IME_ACTION_DONE
            setTextColor(Color.rgb(35, 35, 38))
        }

        inputLayout.addView(edit)
        container.addView(inputLayout)

        val dialog = MaterialAlertDialogBuilder(this)
            .setTitle("修改文件名")
            .setView(container)
            .setNegativeButton("取消", null)
            .setPositiveButton("确定") { _, _ ->
                val value = sanitizeFileName(edit.text?.toString().orEmpty().trim())
                outputName = value.ifBlank { "我的铃声" }
                updateNameButton()
            }
            .create()

        dialog.setOnShowListener {
            dialog.window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
            edit.requestFocus()
            edit.setSelection(edit.text?.length ?: 0)
            edit.postDelayed({
                val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
                imm.showSoftInput(edit, InputMethodManager.SHOW_IMPLICIT)
            }, 150)
        }

        edit.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == android.view.inputmethod.EditorInfo.IME_ACTION_DONE) {
                dialog.getButton(android.app.AlertDialog.BUTTON_POSITIVE)?.performClick()
                true
            } else {
                false
            }
        }

        dialog.show()
    }

    private fun updateNameButton() {
        if (::nameButton.isInitialized) {
            nameButton.text = "文件名  " + outputName + "   ✎"
        }
    }

    private fun makeDefaultOutputName(sourceName: String): String {
        val base = sourceName.substringBeforeLast('.').trim()
        val looksLikeShareName =
            base.startsWith("share_", ignoreCase = true) ||
            base.startsWith("douyin", ignoreCase = true) ||
            base.startsWith("aweme", ignoreCase = true) ||
            base.length > 48

        if (looksLikeShareName) {
            val stamp = SimpleDateFormat("yyyyMMdd_HHmm", Locale.getDefault()).format(Date())
            return "铃声_" + stamp
        }

        return sanitizeFileName(base).take(48).ifBlank { "我的铃声" }
    }

    private fun exportMp3() {
        val uri = selectedUri ?: run {
            toast("请先选择一个视频")
            return
        }

        val values = rangeSlider.values.sorted()
        val start = values[0].toDouble()
        val end = values[1].toDouble()
        val length = end - start

        if (length < 0.1) {
            toast("选择的片段太短")
            return
        }

        val libraries = try {
            FFmpegKitConfig.getExternalLibraries()
        } catch (_: Throwable) {
            emptyList<String>()
        }

        if (libraries.none { it.equals("lame", ignoreCase = true) }) {
            setExporting(false, "当前安装包缺少 MP3(LAME) 编码器")
            return
        }

        stopSelectionPreview()
        setExporting(true, "正在导出 MP3…")

        Thread {
            var input: File? = null
            var ownsInput = false
            var output: File? = null

            try {
                val cached = workingInput
                if (cached != null && cached.exists() && cached.length() > 0) {
                    input = cached
                } else {
                    input = copyUriToCache(uri)
                    ownsInput = true
                }

                output = File(cacheDir, "ringtone_" + System.currentTimeMillis() + ".mp3")

                val command = buildString {
                    append("-hide_banner -y ")
                    append("-i ")
                    append(quote(input.absolutePath))
                    append(" -ss ")
                    append(sec(start))
                    append(" -t ")
                    append(sec(length))
                    append(" -vn -map 0:a:0 ")
                    append("-c:a libmp3lame -b:a 192k ")
                    append("-map_metadata -1 ")
                    append(quote(output.absolutePath))
                }

                val inputFile = input
                val outputFile = output

                FFmpegKit.executeAsync(command) { session ->
                    try {
                        if (
                            ReturnCode.isSuccess(session.returnCode) &&
                            outputFile.exists() &&
                            outputFile.length() > 0
                        ) {
                            val saved = saveToRingtones(outputFile, outputName + ".mp3")
                            runOnUiThread {
                                setExporting(false, "已保存：Ringtones/" + saved)
                                toast("MP3 已保存")
                            }
                        } else {
                            val detail = summarizeFfmpegError(
                                try {
                                    session.allLogsAsString
                                } catch (_: Throwable) {
                                    ""
                                }
                            )
                            runOnUiThread {
                                setExporting(false, "导出失败：" + detail)
                            }
                        }
                    } catch (e: Exception) {
                        runOnUiThread {
                            setExporting(false, "保存失败：" + (e.message ?: "未知错误"))
                        }
                    } finally {
                        if (ownsInput) inputFile.delete()
                        outputFile.delete()
                    }
                }
            } catch (e: Exception) {
                if (ownsInput) input?.delete()
                output?.delete()
                runOnUiThread {
                    setExporting(false, "处理失败：" + (e.message ?: "未知错误"))
                }
            }
        }.start()
    }

    private fun copyUriToCache(uri: Uri): File {
        val sourceName = queryDisplayName(uri) ?: "input.mp4"
        val ext = sourceName.substringAfterLast('.', "mp4").take(8).ifBlank { "mp4" }
        val target = File(cacheDir, "input_" + System.currentTimeMillis() + "." + ext)

        contentResolver.openInputStream(uri).use { input ->
            requireNotNull(input) { "无法读取视频" }
            target.outputStream().use { output ->
                input.copyTo(output)
            }
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
                source.inputStream().use { input ->
                    input.copyTo(out)
                }
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
                MediaStore.Audio.Media.DISPLAY_NAME + "=? AND " +
                    MediaStore.Audio.Media.RELATIVE_PATH + "=?",
                arrayOf(candidate, Environment.DIRECTORY_RINGTONES + "/"),
                null
            )?.use { cursor ->
                cursor.moveToFirst()
            } ?: false

            if (!exists) return candidate
            candidate = stem + " (" + i + ")." + ext
            i += 1
        }
    }

    private fun readDurationMs(uri: Uri): Long {
        val retriever = MediaMetadataRetriever()
        return try {
            retriever.setDataSource(this, uri)
            retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
                ?.toLongOrNull() ?: 0L
        } finally {
            retriever.release()
        }
    }

    private fun queryDisplayName(uri: Uri): String? =
        contentResolver.query(
            uri,
            arrayOf(OpenableColumns.DISPLAY_NAME),
            null,
            null,
            null
        )?.use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0) else null
        }

    private fun setExporting(value: Boolean, message: String) {
        isExporting = value

        chooseButton.isEnabled = !value
        exportButton.isEnabled = !value
        previewButton.isEnabled = !value
        fullButton.isEnabled = !value
        nameButton.isEnabled = !value
        autoOutroSwitch.isEnabled = !value
        rangeSlider.isEnabled = !value

        exportButton.text = if (value) "正在导出…" else "导出 MP3"
        progressBar.visibility = if (value) View.VISIBLE else View.GONE
        statusText.text = message
    }

    private fun summarizeFfmpegError(logs: String): String {
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

    private fun sanitizeFileName(name: String): String =
        name.replace(Regex("[\\/:*?\"<>|]"), "_")
            .replace(Regex("\\s+"), " ")
            .trim('.', ' ')
            .take(80)
            .ifBlank { "我的铃声" }

    private fun cleanupWorkingFiles() {
        workingInput?.delete()
        waveformFile?.delete()
        workingInput = null
        waveformFile = null
    }

    private fun formatTime(seconds: Float): String {
        val tenth = (seconds * 10f).toInt().coerceAtLeast(0)
        return String.format(
            Locale.US,
            "%02d:%02d.%d",
            tenth / 600,
            (tenth / 10) % 60,
            tenth % 10
        )
    }

    private fun sec(value: Double): String =
        String.format(Locale.US, "%.3f", value)

    private fun quote(value: String): String =
        "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density + 0.5f).toInt()

    private fun lpTop(
        top: Int,
        height: Int = LinearLayout.LayoutParams.WRAP_CONTENT
    ): LinearLayout.LayoutParams =
        LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            height
        ).apply {
            topMargin = dp(top)
        }

    private fun toast(message: String) =
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()

    override fun onDestroy() {
        stopSelectionPreview()
        loadGeneration += 1
        cleanupWorkingFiles()
        super.onDestroy()
    }
}
