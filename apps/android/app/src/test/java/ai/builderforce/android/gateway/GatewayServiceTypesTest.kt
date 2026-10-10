package ai.builderforce.android.gateway

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class GatewayServiceTypesTest {
  @Test
  fun browsesOnlyTheBuilderforceType() {
    assertEquals(listOf("_builderforce-gw._tcp."), GatewayServiceTypes.all)
  }

  @Test
  fun matchesTheTypeWithOrWithoutDots() {
    assertEquals("_builderforce-gw._tcp.", GatewayServiceTypes.match("_builderforce-gw._tcp"))
    assertEquals("_builderforce-gw._tcp.", GatewayServiceTypes.match("._builderforce-gw._tcp."))
    assertNull(GatewayServiceTypes.match("_legacy-gw._tcp."))
    assertNull(GatewayServiceTypes.match("_http._tcp."))
  }

  @Test
  fun stripsTheTypeFromWideAreaInstance() {
    assertEquals(
      "studio-gateway.",
      GatewayServiceTypes.instanceLabel("studio-gateway._builderforce-gw._tcp.example.internal.", "example.internal."),
    )
    assertEquals("plain", GatewayServiceTypes.instanceLabel("plain", "example.internal."))
  }
}
