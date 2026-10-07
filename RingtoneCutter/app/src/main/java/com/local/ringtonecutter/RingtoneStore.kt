package com.local.ringtonecutter

import android.content.ContentValues
import android.content.Context
import android.os.Environment
import android.provider.MediaStore
import java.io.File

object RingtoneStore {
    fun save(context: Context, source: File, requestedName: String): String {
        val name = uniqueName(context, requestedName)
        val resolver = context.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.Audio.Media.DISPLAY_NAME, name)
            put(MediaStore.Audio.Media.MIME_TYPE, "audio/mpeg")
            put(MediaStore.Audio.Media.RELATIVE_PATH, Environment.DIRECTORY_RINGTONES)
            put(MediaStore.Audio.Media.IS_RINGTONE, 1)
            put(MediaStore.Audio.Media.IS_MUSIC, 1)
            put(MediaStore.Audio.Media.IS_PENDING, 1)
        }
        val collection = MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        val item = requireNotNull(resolver.insert(collection, values)) { "无法创建铃声文件" }

        try {
            resolver.openOutputStream(item, "w").use { out ->
                requireNotNull(out) { "无法写入铃声文件" }
                source.inputStream().use { input -> input.copyTo(out) }
            }
            resolver.update(
                item,
                ContentValues().apply { put(MediaStore.Audio.Media.IS_PENDING, 0) },
                null,
                null
            )
            return name
        } catch (e: Exception) {
            resolver.delete(item, null, null)
            throw e
        }
    }

    private fun uniqueName(context: Context, requested: String): String {
        val resolver = context.contentResolver
        val stem = requested.substringBeforeLast('.')
        val ext = requested.substringAfterLast('.', "mp3")
        val collection = MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        var candidate = requested
        var index = 1

        while (true) {
            val exists = resolver.query(
                collection,
                arrayOf(MediaStore.Audio.Media._ID),
                MediaStore.Audio.Media.DISPLAY_NAME + "=? AND " +
                    MediaStore.Audio.Media.RELATIVE_PATH + "=?",
                arrayOf(candidate, Environment.DIRECTORY_RINGTONES + "/"),
                null
            )?.use { it.moveToFirst() } ?: false

            if (!exists) return candidate
            candidate = stem + " (" + index + ")." + ext
            index += 1
        }
    }
}
