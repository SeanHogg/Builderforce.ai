package ai.builderforce.android.chat

import ai.builderforce.android.cloud.BrainAttachment
import org.junit.Assert.assertEquals
import org.junit.Test

class AttachmentLinksTest {
  private val base = "https://builderforce.ai/gateway/api/brain/uploads"
  private val photo = BrainAttachment(key = "7/u/1700-ab.png", name = "photo.png", type = "image/png")

  @Test
  fun eachStoredFileLeavesALinkAfterTheText() {
    assertEquals(
      "Look\n\n[Attached: photo.png]($base/7/u/1700-ab.png)",
      withAttachmentLinks("Look", listOf("photo.png" to "$base/7/u/1700-ab.png")),
    )
    // An image-only turn is just its links.
    assertEquals("[Attached: a.jpg]($base/k.jpg)", withAttachmentLinks("", listOf("a.jpg" to "$base/k.jpg")))
    assertEquals("Look", withAttachmentLinks("Look", emptyList()))
  }

  @Test
  fun shownImagesLoseTheirLinksAndOtherLinksStay() {
    val content =
      withAttachmentLinks(
        "Look",
        listOf("photo.png" to "$base/${photo.key}", "doc.pdf" to "$base/7/u/doc.pdf"),
      )
    assertEquals("Look\n\n[Attached: doc.pdf]($base/7/u/doc.pdf)", withoutAttachmentLinks(content, listOf(photo)))
    assertEquals("", withoutAttachmentLinks(attachmentLink("photo.png", "$base/${photo.key}"), listOf(photo)))
  }

  @Test
  fun anUploadNameAlwaysCarriesAnExtension() {
    assertEquals("1000012345.jpg", uploadFileName("1000012345", "image/jpeg"))
    assertEquals("image.png", uploadFileName("", "image/png"))
    assertEquals("cat.webp", uploadFileName("cat.webp", "image/png"))
    assertEquals("icon.svg", uploadFileName("icon", "image/svg+xml"))
    assertEquals("pic", uploadFileName("pic", "image/*"))
  }
}
