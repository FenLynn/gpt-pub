package com.local.ringtonecutter

import android.content.Context
import android.content.DialogInterface
import android.graphics.BitmapFactory
import android.graphics.Color
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.OpenableColumns
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.inputmethod.InputMethodManager
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import android.widget.VideoView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import com.google.android.material.button.MaterialButton
import com.google.android.material.card.MaterialCardView
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
    private lateinit var videoCard: MaterialCardView
    private lateinit var videoFrame: FrameLayout
    private lateinit var videoView: VideoView
    private lateinit var previewTime: TextView
    private lateinit var trimPanel: View
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
    private var sourceName = "video.mp4"
    private var currentDuration = 0f
    private var outputName = "我的铃声"
    private var workingInput: File? = null
    private var loadGeneration = 0
    private var isExporting = false
    private var previewStartMs = 0
    private var previewEndMs = 0
    private var previewStartedAt = 0L

    private val previewHandler = Handler(Looper.getMainLooper())
    private val previewTicker = object : Runnable {
        override fun run() {
            if (!::videoView.isInitialized) return
            val position = videoView.currentPosition.coerceAtLeast(0)
            previewTime.text = "当前播放  " + formatTime(position / 1000f)
            setPlayhead(position / 1000f)

            val stalled = !videoView.isPlaying &&
                System.currentTimeMillis() - previewStartedAt > 700L
            if (position >= previewEndMs - 60 || stalled) {
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
        setContentView(R.layout.activity_main)
        bindViews()
        createRangeSlider()

        autoOutroSwitch.isChecked =
            getSharedPreferences("settings", MODE_PRIVATE)
                .getBoolean("auto_douyin_outro", true)

        setupListeners()
    }

    private fun bindViews() {
        mainScroll = findViewById(R.id.mainScroll)
        chooseButton = findViewById(R.id.chooseButton)
        exportButton = findViewById(R.id.exportButton)
        previewButton = findViewById(R.id.previewButton)
        fullButton = findViewById(R.id.fullButton)
        nameButton = findViewById(R.id.nameButton)
        fileInfo = findViewById(R.id.fileInfo)
        videoCard = findViewById(R.id.videoCard)
        videoFrame = findViewById(R.id.videoFrame)
        videoView = findViewById(R.id.videoView)
        previewTime = findViewById(R.id.previewTime)
        trimPanel = findViewById(R.id.trimPanel)
        autoOutroSwitch = findViewById(R.id.autoOutroSwitch)
        waveformFrame = findViewById(R.id.waveformFrame)
        waveformImage = findViewById(R.id.waveformImage)
        waveformHint = findViewById(R.id.waveformHint)
        playheadView = findViewById(R.id.playheadView)
        startTime = findViewById(R.id.startTime)
        endTime = findViewById(R.id.endTime)
        selectedTime = findViewById(R.id.selectedTime)
        progressBar = findViewById(R.id.progressBar)
        statusText = findViewById(R.id.statusText)
    }

    private fun createRangeSlider() {
        rangeSlider = RangeSlider(this).apply {
            valueFrom = 0f
            valueTo = 1f
            values = listOf(0f, 1f)
            setMinSeparationValue(0.1f)
            isTickVisible = false
            setLabelFormatter { formatTime(it) }
        }
        waveformFrame.addView(
            rangeSlider,
            2,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.CENTER_VERTICAL
            )
        )
        playheadView.bringToFront()
    }

    private fun setupListeners() {
        chooseButton.setOnClickListener {
            if (!isExporting) pickVideo.launch(arrayOf("video/*"))
        }

        exportButton.setOnClickListener {
            if (!isExporting) exportMp3()
        }

        previewButton.setOnClickListener {
            if (!isExporting) toggleSelectionPreview()
        }

        videoView.setOnClickListener {
            if (selectedUri != null && !isExporting) toggleSelectionPreview()
        }

        fullButton.setOnClickListener {
            if (currentDuration > 0f && !isExporting) {
                stopSelectionPreview()
                rangeSlider.values = listOf(0f, currentDuration)
                updateSelectionUi()
                seekPreview(0f)
                statusText.text = "本次已恢复完整范围；手动选择会覆盖自动预剪"
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
                    rangeSlider.values =
                        listOf(min(start, max(0f, currentDuration - 0.1f)), currentDuration)
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
    }

    private fun loadVideo(uri: Uri) {
        stopSelectionPreview()
        loadGeneration += 1
        val generation = loadGeneration
        cleanupWorkingInput()

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

        currentDuration = durationMs / 1000f
        sourceName = queryDisplayName(uri) ?: "video.mp4"
        outputName = makeDefaultOutputName(sourceName)
        updateNameButton()

        fileInfo.text = sourceName + "  ·  " + formatTime(currentDuration)
        videoCard.visibility = View.VISIBLE
        videoFrame.visibility = View.VISIBLE
        trimPanel.visibility = View.VISIBLE
        exportButton.isEnabled = true

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
        if (currentDuration <= 0f) return
        playheadView.visibility = View.VISIBLE
        waveformFrame.post {
            val width = waveformFrame.width
            if (width <= 0) return@post
            val fraction = (seconds / currentDuration).coerceIn(0f, 1f)
            playheadView.translationX = fraction * (width - dp(2))
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
        previewStartedAt = System.currentTimeMillis()
        previewButton.text = "Ⅱ  暂停试听"
        previewHandler.removeCallbacks(previewTicker)
        previewHandler.post(previewTicker)
    }

    private fun stopSelectionPreview() {
        previewHandler.removeCallbacks(previewTicker)
        if (::videoView.isInitialized && videoView.isPlaying) videoView.pause()
        if (::previewButton.isInitialized) previewButton.text = "▶ 试听选中"
    }

    private fun prepareWorkingCopyAndWaveform(uri: Uri, generation: Int) {
        val nameForCopy = sourceName
        Thread {
            var input: File? = null
            var wave: File? = null
            try {
                val localInput = MediaEngine.copyUriToCache(this, uri, nameForCopy)
                input = localInput
                val localWave = File(cacheDir, "waveform_" + System.currentTimeMillis() + ".png")
                wave = localWave
                val result = MediaEngine.generateWaveform(localInput, localWave)

                runOnUiThread {
                    if (generation != loadGeneration || isFinishing || isDestroyed) {
                        localInput.delete()
                        localWave.delete()
                        return@runOnUiThread
                    }

                    workingInput = localInput
                    if (result.success) {
                        val bitmap = BitmapFactory.decodeFile(localWave.absolutePath)
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
                        waveformHint.text = "波形暂不可用，不影响试听与导出"
                    }
                    localWave.delete()
                }
            } catch (e: Exception) {
                input?.delete()
                wave?.delete()
                runOnUiThread {
                    if (generation == loadGeneration && !isFinishing && !isDestroyed) {
                        waveformHint.text = "波形暂不可用，不影响试听与导出"
                        statusText.text = "视频已加载，可以继续剪辑"
                    }
                }
            }
        }.start()
    }

    private fun showRenameDialog() {
        val inputLayout = TextInputLayout(this).apply {
            hint = "MP3 文件名"
            boxBackgroundMode = TextInputLayout.BOX_BACKGROUND_OUTLINE
            setPadding(dp(22), 0, dp(22), 0)
        }

        val edit = TextInputEditText(this).apply {
            setText(outputName)
            isSingleLine = true
            imeOptions = android.view.inputmethod.EditorInfo.IME_ACTION_DONE
            setTextColor(Color.rgb(35, 35, 38))
        }
        inputLayout.addView(edit)

        val dialog = MaterialAlertDialogBuilder(this)
            .setTitle("修改文件名")
            .setView(inputLayout)
            .setNegativeButton("取消", null)
            .setPositiveButton("确定") { _, _ ->
                outputName = sanitizeFileName(edit.text?.toString().orEmpty())
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
            }, 120)
        }

        edit.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == android.view.inputmethod.EditorInfo.IME_ACTION_DONE) {
                dialog.getButton(DialogInterface.BUTTON_POSITIVE)?.performClick()
                true
            } else {
                false
            }
        }

        dialog.show()
    }

    private fun updateNameButton() {
        nameButton.text = "文件名  " + outputName + "   ✎"
    }

    private fun makeDefaultOutputName(fileName: String): String {
        val base = fileName.substringBeforeLast('.').trim()
        val looksLikeShareName =
            base.startsWith("share_", ignoreCase = true) ||
                base.startsWith("douyin", ignoreCase = true) ||
                base.startsWith("aweme", ignoreCase = true) ||
                base.length > 48

        if (looksLikeShareName) {
            val stamp = SimpleDateFormat("yyyyMMdd_HHmm", Locale.getDefault()).format(Date())
            return "铃声_" + stamp
        }
        return sanitizeFileName(base).take(48)
    }

    private fun exportMp3() {
        val uri = selectedUri ?: run {
            toast("请先选择一个视频")
            return
        }

        val values = rangeSlider.values.sorted()
        val start = values[0].toDouble()
        val length = (values[1] - values[0]).toDouble()
        if (length < 0.1) {
            toast("选择的片段太短")
            return
        }

        stopSelectionPreview()
        setExporting(true, "正在导出 MP3…")

        Thread {
            var localInput: File? = null
            var ownsInput = false
            val output = File(cacheDir, "ringtone_" + System.currentTimeMillis() + ".mp3")

            try {
                val cached = workingInput
                localInput =
                    if (cached != null && cached.exists() && cached.length() > 0) {
                        cached
                    } else {
                        ownsInput = true
                        MediaEngine.copyUriToCache(this, uri, sourceName)
                    }

                val result = MediaEngine.exportMp3(localInput, output, start, length)
                if (!result.success) {
                    runOnUiThread {
                        setExporting(false, "导出失败：" + result.detail)
                    }
                    return@Thread
                }

                val saved = RingtoneStore.save(this, output, outputName + ".mp3")
                runOnUiThread {
                    setExporting(false, "已保存：Ringtones/" + saved)
                    toast("MP3 已保存")
                }
            } catch (e: Exception) {
                runOnUiThread {
                    setExporting(false, "处理失败：" + (e.message ?: "未知错误"))
                }
            } finally {
                if (ownsInput) localInput?.delete()
                output.delete()
            }
        }.start()
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

    private fun sanitizeFileName(name: String): String =
        name.trim()
            .replace(Regex("[\\/:*?\"<>|]"), "_")
            .replace(Regex("\\s+"), " ")
            .trim('.', ' ')
            .take(80)
            .ifBlank { "我的铃声" }

    private fun cleanupWorkingInput() {
        workingInput?.delete()
        workingInput = null
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

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density + 0.5f).toInt()

    private fun toast(message: String) =
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()

    override fun onDestroy() {
        stopSelectionPreview()
        loadGeneration += 1
        cleanupWorkingInput()
        super.onDestroy()
    }
}
