package ai.builderforce.android.ui

import ai.builderforce.android.GatewayPhase
import ai.builderforce.android.R
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp

@Composable
fun StatusPill(
  gateway: GatewayPhase,
  voiceEnabled: Boolean,
  onClick: () -> Unit,
  modifier: Modifier = Modifier,
  activity: StatusActivity? = null,
) {
  Surface(
    onClick = onClick,
    modifier = modifier,
    shape = RoundedCornerShape(14.dp),
    color = overlayContainerColor(),
    tonalElevation = 3.dp,
    shadowElevation = 0.dp,
  ) {
    Row(
      modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
      horizontalArrangement = Arrangement.spacedBy(10.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        Surface(
          modifier = Modifier.size(9.dp),
          shape = CircleShape,
          color = gateway.dotColor(),
        ) {}

        Text(
          text = gateway.title(),
          style = MaterialTheme.typography.labelLarge,
        )
      }

      VerticalDivider(
        modifier = Modifier.height(14.dp).alpha(0.35f),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )

      if (activity != null) {
        Row(
          horizontalArrangement = Arrangement.spacedBy(6.dp),
          verticalAlignment = Alignment.CenterVertically,
        ) {
          Icon(
            imageVector = activity.icon,
            contentDescription = activity.contentDescription,
            tint = activity.tint ?: overlayIconColor(),
            modifier = Modifier.size(18.dp),
          )
          Text(
            text = activity.title,
            style = MaterialTheme.typography.labelLarge,
            maxLines = 1,
          )
        }
      } else {
        Icon(
          imageVector = if (voiceEnabled) Icons.Default.Mic else Icons.Default.MicOff,
          contentDescription = stringResource(if (voiceEnabled) R.string.status_voice_enabled else R.string.status_voice_disabled),
          tint =
            if (voiceEnabled) {
              overlayIconColor()
            } else {
              MaterialTheme.colorScheme.onSurfaceVariant
            },
          modifier = Modifier.size(18.dp),
        )
      }

      Spacer(modifier = Modifier.width(2.dp))
    }
  }
}

data class StatusActivity(
  val title: String,
  val icon: androidx.compose.ui.graphics.vector.ImageVector,
  val contentDescription: String,
  val tint: Color? = null,
)

@Composable
private fun GatewayPhase.title(): String =
  stringResource(
    when (this) {
      GatewayPhase.Connected -> R.string.status_pill_connected
      GatewayPhase.Connecting -> R.string.status_pill_connecting
      GatewayPhase.Error -> R.string.status_pill_error
      GatewayPhase.Offline -> R.string.status_pill_offline
    },
  )

/** Status dot colour from the theme's roles (dynamic colour), never fixed literals. */
@Composable
private fun GatewayPhase.dotColor(): Color {
  val scheme = MaterialTheme.colorScheme
  return when (this) {
    GatewayPhase.Connected -> scheme.primary
    GatewayPhase.Connecting -> scheme.tertiary
    GatewayPhase.Error -> scheme.error
    GatewayPhase.Offline -> scheme.outline
  }
}
