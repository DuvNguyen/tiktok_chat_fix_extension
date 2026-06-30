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

### 5. Auto-Spam Mode (🔥 Mode)
A custom spam settings panel is built directly into the top of the chat overlay. 
*   **Trigger**: Click the 🔥 button to toggle the settings drawer. Or press `Ctrl+Enter` (or `Cmd+Enter` on macOS) to instantly start the loop.
*   **Options**:
    *   **Count** (1-99): Number of times to send the text.
    *   **Delay** (20-2000ms): Gap between consecutive messages.
*   **Cancellation**: Press the **`Escape` (ESC)** key or click the **⏹️ (Stop)** button in the UI to instantly stop a running spam loop at any point.
*   **Safety**: Direct React state updating enables super fast loops without UI locks, focus resets, or DOM crash warnings.

### 6. Auto-Sticker Suggestions
Type keyword synonyms to trigger instant sticker suggestions.
*   **Keywords**: `huhu` (or `khóc`, `crying`), `haha` (or `cười`, `kaka`), `love` (or `tim`, `thương`), `wow` (or `sốc`), `angry` (or `giận`, `mad`), `hello` (or `hi`, `xin chào`).
*   **Meme-y & Trendy Set**: Loaded with TikTok-favorite animated transparent stickers (e.g. Quby crying, sad cat stare, crying kitten meme).
*   **Auto-Send**: The extension bypassed manual submission by polling TikTok's native upload queue. Once the sticker upload completes, it instantly triggers a click event to send it automatically without user action.
*   **Security & Bypass**: The extension's Background Service Worker fetches the public Giphy transparent CDN assets to bypass CORS/CSP constraints, converts them into File blobs, and programmatically pastes them directly into Draft.js via simulated browser paste events.

## 📖 Hướng Dẫn Sử Dụng / User Guide

### 1. Nhắn Tin Thường / Normal Chatting
*   **Tiếng Việt**: Gõ văn bản mượt mà tại ô nhập liệu mới mà không lo bị lỗi Telex/VNI hay mất chữ. Nhấn **Enter** để gửi tin nhắn, hoặc **Shift + Enter** để xuống dòng.
*   **English**: Type smoothly in the new text area without worrying about Vietnamese IME drops or character loss. Press **Enter** to send, or **Shift + Enter** to insert a new line.

### 2. Sử Dụng Emoji / Using Emojis
*   **Tiếng Việt**: Nhấn nút Emoji gốc của TikTok (ở phía bên phải thanh chat). Biểu tượng được chọn sẽ tự động đồng bộ và hiển thị vào con trỏ chuột của ô nhập liệu mới.
*   **English**: Click the native TikTok emoji button next to the input area. The selected emoji will be synced and inserted at your cursor position in the custom textarea.

### 3. Chế Độ Spam Tự Động / Auto-Spam Mode (🔥 Mode)
*   **Tiếng Việt**:
    *   Nhấp vào nút **🔥** để bật/tắt bảng cấu hình Spam.
    *   Nhập **Số lượng (Count)** (từ 1 - 99 tin) và **Độ trễ (Delay)** (từ 20ms - 2000ms).
    *   Nhấn **Ctrl + Enter** (hoặc **Cmd + Enter** trên Mac) để kích hoạt spam nhanh tin nhắn đang nhập.
    *   Nhấn **Escape (ESC)** hoặc nút **⏹️** để dừng spam khẩn cấp bất kỳ lúc nào.
*   **English**:
    *   Click the **🔥** button to toggle the Spam Settings Panel.
    *   Configure **Count** (1-99) and **Delay** (20-2000ms).
    *   Press **Ctrl + Enter** (or **Cmd + Enter** on macOS) to instantly start the spam loop for the current message.
    *   Press **Escape (ESC)** or click the **⏹️ (Stop)** button to abort the loop immediately.

### 4. Gợi Ý Sticker Động / Auto-Stickers Suggestion
*   **Tiếng Việt**:
    *   Nhập các từ khóa cảm xúc: `huhu` (`khóc`), `haha` (`cười`, `kaka`), `love` (`tim`, `thương`), `wow` (`sốc`), `angry` (`giận`), `hello` (`hi`, `xin chào`).
    *   Chọn sticker động yêu thích hiển thị phía trên. Sticker sẽ được tải về, dán và tự động gửi đi ngay khi upload thành công mà không cần thao tác nào khác.
*   **English**:
    *   Type keywords like: `huhu` (`crying`), `haha` (`laugh`), `love` (`heart`), `wow` (`surprise`), `angry` (`mad`), `hello` (`hi`).
    *   Click your favorite animated sticker from the suggestions panel. The extension will fetch, paste, and automatically send the sticker once the upload completes.

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

