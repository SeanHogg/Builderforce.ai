package ai.builderforce.android.protocol

import org.junit.Assert.assertEquals
import org.junit.Test

class BuilderforceProtocolConstantsTest {
  @Test
  fun canvasCommandsUseStableStrings() {
    assertEquals("canvas.present", BuilderforceCanvasCommand.Present.rawValue)
    assertEquals("canvas.hide", BuilderforceCanvasCommand.Hide.rawValue)
    assertEquals("canvas.navigate", BuilderforceCanvasCommand.Navigate.rawValue)
    assertEquals("canvas.eval", BuilderforceCanvasCommand.Eval.rawValue)
    assertEquals("canvas.snapshot", BuilderforceCanvasCommand.Snapshot.rawValue)
  }

  @Test
  fun a2uiCommandsUseStableStrings() {
    assertEquals("canvas.a2ui.push", BuilderforceCanvasA2UICommand.Push.rawValue)
    assertEquals("canvas.a2ui.pushJSONL", BuilderforceCanvasA2UICommand.PushJSONL.rawValue)
    assertEquals("canvas.a2ui.reset", BuilderforceCanvasA2UICommand.Reset.rawValue)
  }

  @Test
  fun capabilitiesUseStableStrings() {
    assertEquals("canvas", BuilderforceCapability.Canvas.rawValue)
    assertEquals("camera", BuilderforceCapability.Camera.rawValue)
    assertEquals("screen", BuilderforceCapability.Screen.rawValue)
    assertEquals("voiceWake", BuilderforceCapability.VoiceWake.rawValue)
  }

  @Test
  fun screenCommandsUseStableStrings() {
    assertEquals("screen.record", BuilderforceScreenCommand.Record.rawValue)
  }
}
