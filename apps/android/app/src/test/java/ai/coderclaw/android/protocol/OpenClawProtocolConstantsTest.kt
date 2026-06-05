package ai.coderclaw.android.protocol

import org.junit.Assert.assertEquals
import org.junit.Test

class CoderClawProtocolConstantsTest {
  @Test
  fun canvasCommandsUseStableStrings() {
    assertEquals("canvas.present", CoderClawCanvasCommand.Present.rawValue)
    assertEquals("canvas.hide", CoderClawCanvasCommand.Hide.rawValue)
    assertEquals("canvas.navigate", CoderClawCanvasCommand.Navigate.rawValue)
    assertEquals("canvas.eval", CoderClawCanvasCommand.Eval.rawValue)
    assertEquals("canvas.snapshot", CoderClawCanvasCommand.Snapshot.rawValue)
  }

  @Test
  fun a2uiCommandsUseStableStrings() {
    assertEquals("canvas.a2ui.push", CoderClawCanvasA2UICommand.Push.rawValue)
    assertEquals("canvas.a2ui.pushJSONL", CoderClawCanvasA2UICommand.PushJSONL.rawValue)
    assertEquals("canvas.a2ui.reset", CoderClawCanvasA2UICommand.Reset.rawValue)
  }

  @Test
  fun capabilitiesUseStableStrings() {
    assertEquals("canvas", CoderClawCapability.Canvas.rawValue)
    assertEquals("camera", CoderClawCapability.Camera.rawValue)
    assertEquals("screen", CoderClawCapability.Screen.rawValue)
    assertEquals("voiceWake", CoderClawCapability.VoiceWake.rawValue)
  }

  @Test
  fun screenCommandsUseStableStrings() {
    assertEquals("screen.record", CoderClawScreenCommand.Record.rawValue)
  }
}
