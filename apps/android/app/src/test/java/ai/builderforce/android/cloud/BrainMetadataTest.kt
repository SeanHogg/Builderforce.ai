package ai.builderforce.android.cloud

import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BrainMetadataTest {
  private val ada = Recipient(ref = "12", name = "Ada")
  private val photo = BrainAttachment(key = "7/u/1700-ab.png", name = "photo.png", type = "image/png")

  @Test
  fun aTurnToTheBrainWithNothingAttachedHasNoMetadata() {
    assertNull(turnMetadata(null, emptyList()))
  }

  @Test
  fun theRecipientAndTheAttachmentsShareOneMetadataObject() {
    assertEquals(
      """{"addressedTo":{"kind":"agent","ref":"12","name":"Ada"},""" +
        """"attachments":[{"key":"7/u/1700-ab.png","name":"photo.png","type":"image/png"}]}""",
      turnMetadata(ada, listOf(photo)),
    )
  }

  @Test
  fun eachHalfStandsAlone() {
    assertEquals("""{"addressedTo":{"kind":"agent","ref":"12","name":"Ada"}}""", turnMetadata(ada, emptyList()))
    assertEquals(
      """{"attachments":[{"key":"7/u/1700-ab.png","name":"photo.png","type":"image/png"}]}""",
      turnMetadata(null, listOf(photo)),
    )
  }

  @Test
  fun builtMetadataParsesBackIntoTheSameTurn() {
    val metadata = turnMetadata(ada, listOf(photo))!!
    val el =
      buildJsonObject {
        put("id", JsonPrimitive(3))
        put("role", JsonPrimitive("user"))
        put("content", JsonPrimitive("look"))
        put("metadata", JsonPrimitive(metadata))
      }
    val m = parseMessage(el, 0)!!
    assertEquals(listOf("Ada"), m.addressedTo)
    assertEquals(listOf(photo), m.attachments)
  }

  @Test
  fun attachmentsParseFromStringOrObjectMetadataAndSkipEntriesWithoutAKey() {
    val asString =
      parseCloudBody(
        """{"id":1,"role":"user","content":"",""" +
          """"metadata":"{\"attachments\":[{\"key\":\"7/u/a.jpg\",\"name\":\"a.jpg\",\"type\":\"image/jpeg\"},{\"name\":\"no key\"}]}"}""",
      )
    val m = parseMessage(asString, 0)!!
    assertEquals(listOf(BrainAttachment("7/u/a.jpg", "a.jpg", "image/jpeg")), m.attachments)
    // An image-only turn is still one a person reads.
    assertEquals(listOf(m), visibleMessages(listOf(m)))

    val asObject =
      parseCloudBody("""{"id":2,"role":"user","content":"x","metadata":{"attachments":[{"key":"7/u/doc.pdf","type":"application/pdf"}]}}""")
    val doc = parseMessage(asObject, 0)!!.attachments.single()
    assertEquals("doc.pdf", doc.name)
    assertFalse(doc.isImage)
    assertTrue(photo.isImage)
  }

  @Test
  fun aTurnWithoutMetadataHasNoAttachments() {
    val m = parseMessage(parseCloudBody("""{"id":4,"role":"assistant","content":"hi"}"""), 0)!!
    assertTrue(m.attachments.isEmpty())
  }

  @Test
  fun anUploadIsReadBackFromTheTenantCheckedPath() {
    assertEquals(
      "https://builderforce.ai/gateway/api/brain/uploads/7/u/1700-ab.png",
      BrainChatApi.uploadUrl("https://builderforce.ai/gateway", photo.key),
    )
  }
}
