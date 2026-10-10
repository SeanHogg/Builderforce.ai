package ai.coderclaw.android.ui

import androidx.compose.runtime.Composable
import ai.coderclaw.android.MainViewModel
import ai.coderclaw.android.ui.chat.ChatSheetContent

@Composable
fun ChatSheet(viewModel: MainViewModel) {
  ChatSheetContent(viewModel = viewModel)
}
