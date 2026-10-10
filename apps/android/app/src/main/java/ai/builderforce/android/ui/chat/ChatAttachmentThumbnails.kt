package ai.builderforce.android.ui.chat

import ai.builderforce.android.R
import ai.builderforce.android.cloud.BrainAttachment
import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Reads a stored attachment's bytes as the signed-in person (the uploads route is tenant-checked). */
typealias AttachmentImageLoader = suspend (key: String) -> ByteArray?

/** A stored turn's images, as a row of thumbnails read back from the uploads store. */
@Composable
fun ChatAttachmentThumbnails(images: List<BrainAttachment>, load: AttachmentImageLoader) {
  Row(
    modifier = Modifier.horizontalScroll(rememberScrollState()),
    horizontalArrangement = Arrangement.spacedBy(6.dp),
  ) {
    for (image in images) {
      AttachmentThumbnail(image, load)
    }
  }
}

private sealed interface Thumbnail {
  data object Loading : Thumbnail

  data object Unavailable : Thumbnail

  data class Shown(val bitmap: ImageBitmap) : Thumbnail
}

@Composable
private fun AttachmentThumbnail(image: BrainAttachment, load: AttachmentImageLoader) {
  val state by
    produceState<Thumbnail>(Thumbnail.Loading, image.key) {
      val bytes = load(image.key)
      value = bytes?.let { withContext(Dispatchers.Default) { decodeThumbnail(it) } }?.let { Thumbnail.Shown(it) } ?: Thumbnail.Unavailable
    }
  val shape = RoundedCornerShape(10.dp)
  val label = stringResource(R.string.chat_attached_image, image.name)
  when (val s = state) {
    is Thumbnail.Shown ->
      Image(
        bitmap = s.bitmap,
        contentDescription = label,
        contentScale = ContentScale.Crop,
        modifier = Modifier.size(THUMB_DP.dp).clip(shape),
      )
    else ->
      Surface(shape = shape, color = MaterialTheme.colorScheme.surfaceVariant, modifier = Modifier.size(THUMB_DP.dp)) {
        Box(contentAlignment = Alignment.Center) {
          if (s == Thumbnail.Unavailable) {
            Text(
              stringResource(R.string.chat_attachment_unavailable),
              style = MaterialTheme.typography.labelSmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
              textAlign = TextAlign.Center,
              modifier = Modifier.padding(6.dp),
            )
          }
        }
      }
  }
}

private const val THUMB_DP = 120
private const val THUMB_PX = 360

/** Decode at roughly thumbnail size: a phone photo at full size is tens of megabytes of pixels. */
private fun decodeThumbnail(bytes: ByteArray): ImageBitmap? {
  val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
  BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
  if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
  var sample = 1
  while (minOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= THUMB_PX) sample *= 2
  val options = BitmapFactory.Options().apply { inSampleSize = sample }
  return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)?.asImageBitmap()
}
