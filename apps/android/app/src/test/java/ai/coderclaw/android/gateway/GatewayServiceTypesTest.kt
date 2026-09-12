package ai.coderclaw.android.gateway

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class GatewayServiceTypesTest {
  @Test
  fun browsesCurrentTypeFirstAndKeepsLegacyType() {
    assertEquals(listOf("_builderforce-gw._tcp.", "_coderclaw-gw._tcp."), GatewayServiceTypes.all)
  }

  @Test
  fun matchesEitherTypeWithOrWithoutDots() {
    assertEquals("_builderforce-gw._tcp.", GatewayServiceTypes.match("_builderforce-gw._tcp"))
    assertEquals("_builderforce-gw._tcp.", GatewayServiceTypes.match("._builderforce-gw._tcp."))
    assertEquals("_coderclaw-gw._tcp.", GatewayServiceTypes.match("_coderclaw-gw._tcp."))
    assertNull(GatewayServiceTypes.match("_http._tcp."))
  }

  @Test
  fun stripsEitherTypeFromWideAreaInstance() {
    assertEquals(
      "studio-gateway.",
      GatewayServiceTypes.instanceLabel("studio-gateway._builderforce-gw._tcp.example.internal.", "example.internal."),
    )
    assertEquals(
      "studio-gateway.",
      GatewayServiceTypes.instanceLabel("studio-gateway._coderclaw-gw._tcp.example.internal.", "example.internal."),
    )
    assertEquals("plain", GatewayServiceTypes.instanceLabel("plain", "example.internal."))
  }
}
