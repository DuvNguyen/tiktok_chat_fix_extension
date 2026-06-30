# TikTok Chat Typing Fixer (Chrome Extension)

A lightweight and elegant Chrome Extension (Manifest V3) designed to fix typing glitches, Vietnamese IME character drops, and message sending issues on TikTok Web's Direct Messaging page (`/messages`).

---

## 🚀 Core Technologies & Architecture

*   **Manifest V3**: Uses secure Chromium extension specifications for page content injection.
*   **Direct React State Interception**: Injects a page-context script (`inject.js`) to traverse TikTok's React Fiber tree, retrieve Draft.js constructor references (`EditorState`, `ContentState`) from runtime instances, and synchronously update the model.
*   **Floating Overlay with Layout Syncing**: Overlays a clean custom `<textarea>` exactly over the native input area using `ResizeObserver` and `getBoundingClientRect`. This completely bypasses Draft.js IME issues while keeping the layout flexible.
*   **Dynamic Layout Padding Adjustment**: Automatically detects shifts in the input height and pushes up the messages scroll list container, ensuring text inputs never cover active conversation bubbles.
*   **Zero-Focus Shifts**: Since text is injected and cleared directly via the React Fiber tree in the page context, sending messages does not require changing browser selection or stealing focus, enabling high-frequency typing.
*   **Messenger-style Fast Submission**: Employs instant text box clearing, silent direct-state clear commands, and native Enter key dispatching to enable rapid, consecutive message sending (spamming).

---

## 🛠️ How to Load as an Unpacked Extension

1.  Open **Google Chrome** (or any Chromium-based browser like Brave or Edge).
2.  Navigate to `chrome://extensions/` by typing it into the URL bar and pressing Enter.
3.  In the top-right corner, toggle the **Developer mode** switch to **ON**.
4.  In the top-left corner, click the **Load unpacked** button.
5.  Select the project folder: `/home/levi/Desktop/tiktok_chat_fix_extension`.
6.  The extension is now active! Navigate to [TikTok Messages](https://www.tiktok.com/messages) to see it in action.
7.  If you make changes to the code, simply click the **Reload** (circular arrow) icon on the extension's card to apply updates.

---

## 🔍 How It Works Under the Hood

### 1. Bypassing the Vietnamese IME Bug
TikTok's native input uses React and Draft.js. When typing Vietnamese (Telex/VNI) or typing very fast, Draft.js's state reconciliation conflicts with the browser's native IME composition events. This causes characters to double up, scatter, or jump around.
*   **Fix**: We hide the native input visually and overlay a standard `<textarea>`. The browser processes composition events natively in the `<textarea>` without any React interference, producing a smooth typing experience.

### 2. Direct React State Update (`inject.js`)
When a message is sent (by pressing Enter or clicking our custom Send button), the extension:
1.  Sends a `SEND_MESSAGE` postMessage request to the page context.
2.  `inject.js` receives the request, finds the React Fiber node of the native contenteditable, and traverses up the node's `.return` tree to find the Draft.js `Editor` component props.
3.  It pulls the current `editorState`, gets its `.constructor` (the `EditorState` class), and updates it by pushing a new `ContentState` created from the text (plus a trailing space to prevent character drop).
4.  It calls `props.onChange(newEditorState)` to update the React state model instantly.
5.  It dispatches a native `keydown` Enter event on the native input to submit the message through TikTok's internal submission handler.

### 3. Silent Input Clearing
To clean the native input box after copying text or syncing emojis:
*   We send a `CLEAR_INPUT` message to `inject.js`.
*   It pushes an empty `ContentState` through `props.onChange` to clear the React state silently, avoiding any DOM manipulation or focus redirection.

### 4. Emoji Synchronization
When the native TikTok emoji picker is clicked, it inserts the emoji into the hidden native contenteditable element.
*   **Fix**: We listen to the native input's `'input'` event. When an emoji is added, we clean any zero-width spaces (`\u200B`), insert it at the cursor position of our custom `<textarea>`, and issue a `CLEAR_INPUT` command to clear the native input.

---

## ⚙️ Customization & Updating Selectors

If TikTok updates its website and changes its HTML structure, you can easily adjust the selectors at the very top of `content.js`:

```javascript
// ==========================================
// 1. CONFIGURATION SELECTORS
// ==========================================
const SELECTORS = {
    // Selector for TikTok's native chat editor (Draft.js contenteditable div)
    NATIVE_INPUT: 'div[contenteditable="true"].public-DraftEditor-content, div[contenteditable="true"]',
};
```
