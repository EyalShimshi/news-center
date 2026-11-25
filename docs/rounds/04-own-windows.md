# Round 4 – a channel in its own window

## The request

> Make it possible to detach a stream from the program, like taking it as a separate window and
> putting it anywhere else.

## The answer

In the Windows app any channel can leave the grid for **a window of its own**, and on Android the
big channel can **pop out** into a floating window.

**What's new**

- **Windows – a channel in its own window.** Every channel has an *own window* button (next to
  fullscreen; `D` on the keyboard). The channel moves out of the grid into an ordinary window,
  named after the channel, with a dark title bar. The window can go anywhere: on another monitor,
  beside other apps or on top of them.
  - The window has the channel's M, S, volume, reload and meter buttons, and the round button in
    its middle makes it the only channel heard. The main window keeps one mixer for everything:
    what you press in either window changes both, and the window plays exactly what the mixer says.
  - **Pin** (`T`) keeps the window on top; **fullscreen** (`F`, or a double-click) fills its
    monitor, and `Esc` brings the window back.
  - **Back**: the window's grid button (`D`), or closing the window (its X, Alt+F4, the taskbar, or
    another program), puts the channel back in the grid where it was.
  - When the channel goes off air the window closes, and it reopens when the channel is back on
    air. News Center remembers which channels are in their own windows and where each window was
    (and whether it was pinned), so they reopen there after a restart, without taking the focus.
  - The grid, the channel manager and the title bar's summary count the channels in their own
    windows. When every channel on air is in its own window, the grid says so. Watching a live
    session from the Knesset view brings its window forward.
- **Android – pop out.** The big channel, and fullscreen, have a pop-out button that puts the
  channel into Android's floating picture-in-picture window, which can be moved anywhere on the
  screen and stays over other apps. Leaving the app still does the same (Settings →
  Picture-in-picture).

**Fixed** – in a narrow window (under about 1,000 pixels), the "News Center" name in the title bar
spilled over the layout buttons while the window was inactive. That became common with a channel's
window in front. The name now shortens, or hides when there's no room.

**To ship** – merged to `main` and released as `v1.3.0` with `news-center-windows-v1.3.0.zip`,
`news-center-v1.3.0.apk` and `mapping-v1.3.0.zip`.

**To test (Windows)**

1. Unzip `news-center-windows-v1.3.0.zip` and run `NewsCenter.exe`.
2. Point at a channel and press the two-squares button next to fullscreen (or select the channel
   and press `D`): it opens in its own window and leaves the grid.
3. Drag the window to another monitor. Press the pin to keep it on top, double-click it to fill
   that monitor, and press `Esc` to come back.
4. Press **S** or the round button in the window: the main window's mixer follows.
5. Close the window: the channel is back in the grid.
6. Move a channel out again and restart News Center: it reopens in its window, in the same place.

**To test (Android)** – install `news-center-v1.3.0.apk` over 1.2.0, tap a channel, then the
pop-out button in a top corner of the big picture: the channel floats over the home screen. Drag
it anywhere; tap it and press the expand button to return.

**Heads-up**

- On Android only one channel can float at a time: picture-in-picture is one window per app.
- Channel 12 (Mako's page) can have its own window on Windows; on Android it can't float.
- Nothing was built or run on this computer. GitHub's machines built both apps and ran them (the
  Windows program on a Windows build machine, driven through its debugging port, and the APK on
  an Android emulator), and the working copy was deleted at the end.

**Next options**

1. Several channels in one detached window: a second, smaller multiview for another monitor.
2. The Knesset view in its own window, to read it beside the channels.
3. Background audio with a media notification on Android.

## How it was made

- **One page, two modes.** A channel's window is the dashboard page itself, opened as
  `index.html?channel=<id>`: it builds the same tile (player, meter, controls) for one channel and
  hides everything else. It never saves settings. The main window saves the channel before it asks
  for the window, and the window reads it from there.
- **One mixer.** The two pages share the origin and the browser profile, so they talk over a
  `BroadcastChannel`. The main window applies the sound rules to every channel, including the ones
  in windows, and sends each window its gain, mute, solo and "heard alone" state. The window
  forwards its buttons and keys, and reports whether its channel is playing, buffering or off air.
  A window stays silent until the main window tells it what to play.
- **The host.** `host/src/ChannelWindow.cs` is the window: a normal resizable window with a dark
  title bar and a WebView2 on the main window's browser environment. The same code now sets up
  both windows' browsers (`PrepareBrowserAsync`: the app's address, blocked sites, links opening
  in the browser). The window handles pin (on top), fullscreen on its monitor, and remembers its
  place in `channel-windows.json`. The main window opens and closes channel windows when the page
  asks, and tells the page when the user closed one.
- **Testing.** The desktop CI job now runs the built program. `desktop-window-test.mjs` starts
  `NewsCenter.exe` with its debugging port on, gives it a public test stream as the only channel,
  and drives both windows: detach, playback in the window, the mixer both ways, pin (checked with
  Windows), fullscreen, the back button, closing the window as a user and as another program would,
  and a restart. It saves screenshots of both pages and of the desktop. Its first run found that a
  close from another program left the channel without a window (SPEC.md D-30). The Android emulator
  test presses pop out and waits for Android to report picture-in-picture.

## Status

Released as `v1.3.0`; see the [releases](https://github.com/EyalShimshi/news-center/releases).
