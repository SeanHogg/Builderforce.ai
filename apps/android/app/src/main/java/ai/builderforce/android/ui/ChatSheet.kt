package ai.builderforce.android.ui

import androidx.compose.runtime.Composable
import ai.builderforce.android.MainViewModel
import ai.builderforce.android.ui.chat.ChatSheetContent

@Composable
fun ChatSheet(viewModel: MainViewModel) {
  ChatSheetContent(viewModel = viewModel)
}
