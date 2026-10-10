package ai.builderforce.android.chat

import ai.builderforce.android.cloud.Recipient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MentionTest {
  private val ann = Recipient(ref = "1", name = "Ann")
  private val annLee = Recipient(ref = "2", name = "Ann Lee")

  @Test
  fun theLongestNameAtTheStartWins() {
    assertEquals(annLee, mentionedAgent("@Ann Lee please look", listOf(ann, annLee)))
    assertEquals(ann, mentionedAgent("  @ann, please look", listOf(ann, annLee)))
  }

  @Test
  fun aNameMustEndAtAWordBoundary() {
    assertNull(mentionedAgent("@Annabel hi", listOf(ann)))
    assertNull(mentionedAgent("hi @Ann", listOf(ann)))
  }
}
