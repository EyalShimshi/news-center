package io.github.eyalshimshi.newscenter.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** Grouped lists: items share one card with large outer corners and small corners between them. */
object GroupShapes {
    val Outer: Dp = 24.dp
    val Inner: Dp = 4.dp
    val Gap: Dp = 2.dp
}

/** The shape of item [index] in a group of [count] items. */
fun groupItemShape(index: Int, count: Int): Shape {
    val first = index == 0
    val last = index == count - 1
    return RoundedCornerShape(
        topStart = if (first) GroupShapes.Outer else GroupShapes.Inner,
        topEnd = if (first) GroupShapes.Outer else GroupShapes.Inner,
        bottomEnd = if (last) GroupShapes.Outer else GroupShapes.Inner,
        bottomStart = if (last) GroupShapes.Outer else GroupShapes.Inner,
    )
}

/** A titled group of cards: large outer corners, small corners between its items. */
@Composable
fun SettingsGroup(title: String, content: @Composable ColumnScope.() -> Unit) {
    Text(
        text = title,
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 24.dp, bottom = 8.dp),
    )
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(GroupShapes.Outer)),
        verticalArrangement = Arrangement.spacedBy(GroupShapes.Gap),
        content = content,
    )
}

@Composable
fun GroupCard(content: @Composable () -> Unit) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(GroupShapes.Inner),
        color = MaterialTheme.colorScheme.surfaceContainer,
        content = content,
    )
}

@Composable
fun SwitchRow(title: String, summary: String?, checked: Boolean, onChange: (Boolean) -> Unit) {
    GroupCard {
        ListItem(
            headlineContent = { Text(title) },
            supportingContent = if (summary != null) {
                { Text(summary) }
            } else {
                null
            },
            trailingContent = { Switch(checked = checked, onCheckedChange = null) },
            colors = ListItemDefaults.colors(containerColor = Color.Transparent),
            modifier = Modifier.toggleable(value = checked, onValueChange = onChange, role = Role.Switch),
        )
    }
}

/** A radio option; place inside a [GroupCard] together with the other options. */
@Composable
fun RadioRow(title: String, selected: Boolean, onSelect: () -> Unit) {
    ListItem(
        headlineContent = { Text(title) },
        leadingContent = { RadioButton(selected = selected, onClick = null) },
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
        modifier = Modifier.selectable(selected = selected, onClick = onSelect, role = Role.RadioButton),
    )
}

@Composable
fun ClickRow(title: String, summary: String?, onClick: () -> Unit) {
    GroupCard {
        ListItem(
            headlineContent = { Text(title) },
            supportingContent = if (summary != null) {
                { Text(summary) }
            } else {
                null
            },
            colors = ListItemDefaults.colors(containerColor = Color.Transparent),
            modifier = Modifier.selectable(selected = false, onClick = onClick, role = Role.Button),
        )
    }
}
