/**
 * TikTok Chat Typing Fixer - Content Script
 * 
 * Fully reformed architecture:
 * 1. Bypasses React reconciliation and Vietnamese IME bugs by using a custom textarea overlay.
 * 2. Injects a page-context script (inject.js) to directly read/write Draft.js state.
 * 3. Communicates via postMessage:
 *    - SEND_MESSAGE: Instantly updates Draft.js state and dispatches Enter to send.
 *    - CLEAR_INPUT: Silently clears Draft.js state without changing browser focus.
 * 4. Simplifies emoji sync by using a standard 'input' event listener on the native input,
 *    completely removing complex, loop-prone MutationObservers.
 */

// ==========================================
// 1. CONFIGURATION SELECTORS
// ==========================================
const SELECTORS = {
    NATIVE_INPUT: 'div[contenteditable="true"].public-DraftEditor-content, div[contenteditable="true"]',
};

// ==========================================
// 2. STATE & GLOBALS
// ==========================================
let currentUrl = window.location.href;
let alignmentInterval = null;
let resizeObserver = null;
let themeObserver = null;
let activeNativeInput = null;
let domObserver = null;
let isFocusRedirectBlocked = false;
let isSpamming = false;
let escapeListener = null;

// Curved Animated Stickers Mapping (using high-quality Giphy transparent sticker assets matching TikTok mobile app memes)
const STICKER_MAP = {
    'huhu': [
        'https://media.giphy.com/media/kcfDb6ihrl4K3Us4Gv/giphy.gif', // Timo/Quby crying (White round character)
        'https://media.giphy.com/media/10t5T4cGf0GJoY/giphy.gif', // Crying seal/round character
        'https://media.giphy.com/media/yFQ0ywscgobJK/giphy.gif', // Sad cat staring meme
        'https://media.giphy.com/media/8YutMatqkTfSE/giphy.gif', // Sad kitten crying meme
        'https://media.giphy.com/media/OPU6wUKVOA06I/giphy.gif'  // SpongeBob crying
    ],
    'haha': [
        'https://media.giphy.com/media/10t5T4cGf0GJoY/giphy.gif', // Laughing cute
        'https://media.giphy.com/media/coC17Ku3s3pHG/giphy.gif', // Minion laugh
        'https://media.giphy.com/media/wW95fEq0gCoSc/giphy.gif', // Laughing cat
        'https://media.giphy.com/media/1d5ZN04sm44yk/giphy.gif'  // Laughing girl
    ],
    'love': [
        'https://media.giphy.com/media/26hpKunjT8sDSs7zW/giphy.gif', // Heart love
        'https://media.giphy.com/media/l41JWdNoYRz1Jt7uU/giphy.gif', // Heart sticker
        'https://media.giphy.com/media/3IUs0MCo9Y750t7V4p/giphy.gif', // Cute bear love
        'https://media.giphy.com/media/T862e3KeHp4V4sF15M/giphy.gif'  // Heart hands
    ],
    'wow': [
        'https://media.giphy.com/media/3o7527pa7qs9kCG78A/giphy.gif', // Wow sticker
        'https://media.giphy.com/media/ccCalIfv11gXU2Wn5V/giphy.gif', // Surprised cat
        'https://media.giphy.com/media/t38v6d91pEAE0/giphy.gif',    // Shocked baby
        'https://media.giphy.com/media/LfGGW219qPxE4/giphy.gif'     // Minion wow
    ],
    'angry': [
        'https://media.giphy.com/media/l0G18bM1hFkuTcU5G/giphy.gif', // Angry cute
        'https://media.giphy.com/media/Gj8b1vO9t5FnG/giphy.gif',     // Red face angry
        'https://media.giphy.com/media/U7b8cc42c7RhM4Qgvt/giphy.gif', // Angry cat
        'https://media.giphy.com/media/fnQn7xMv7SStG/giphy.gif'     // Mad sponge
    ],
    'hello': [
        'https://media.giphy.com/media/3oKIPnAiaAODhgKBVK/giphy.gif', // Hello sticker
        'https://media.giphy.com/media/djAPV3L19wW64/giphy.gif',     // Wave cat
        'https://media.giphy.com/media/dzaUX1mnVW6Sk/giphy.gif',     // Hello bear
        'https://media.giphy.com/media/l0FF56/giphy.gif'            // Stitch wave
    ]
};

const SYNONYMS = {
    'khóc': 'huhu',
    'crying': 'huhu',
    'cười': 'haha',
    'kaka': 'haha',
    'tim': 'love',
    'thương': 'love',
    'sốc': 'wow',
    'surprise': 'wow',
    'giận': 'angry',
    'mad': 'angry',
    'hi': 'hello',
    'xin chào': 'hello'
};

// ==========================================
// 3. CORE UTILITIES
// ==========================================

function isMessagesPage() {
    return window.location.pathname.includes('/messages');
}

/**
 * Searches the DOM to find the scrollable message list container
 */
function findMessagesContainer(nativeInput) {
    if (!nativeInput) return null;
    
    let current = nativeInput.parentElement;
    let depth = 0;
    while (current && depth < 12) {
        const scrollContainer = current.querySelector('div[class*="DivMessageList"], div[class*="MessageList"], div[class*="ChatList"], div[class*="ChatContainer"], div[class*="DivChatContainer"]');
        if (scrollContainer) {
            return scrollContainer;
        }
        
        const overflowY = window.getComputedStyle(current).overflowY;
        if ((overflowY === 'auto' || overflowY === 'scroll') && current.querySelector('[class*="Message"], [class*="Bubble"]')) {
            return current;
        }
        
        current = current.parentElement;
        depth++;
    }
    
    return document.querySelector('div[class*="MessageList"], div[class*="ChatList"], div[class*="DivChatContainer"]');
}

/**
 * Dynamically adjusts the bottom padding of the messages container to prevent overlay coverage
 */
function adjustMessagesPadding(nativeInput, nativeHeight, customHeight) {
    const messagesContainer = findMessagesContainer(nativeInput);
    if (!messagesContainer) return;

    const extraHeight = Math.max(0, customHeight - nativeHeight);

    if (messagesContainer.dataset.originalPadding === undefined) {
        const computedStyle = window.getComputedStyle(messagesContainer);
        messagesContainer.dataset.originalPadding = parseFloat(computedStyle.paddingBottom) || 0;
    }

    const originalPadding = parseFloat(messagesContainer.dataset.originalPadding);
    const newPadding = originalPadding + extraHeight;
    messagesContainer.style.paddingBottom = `${newPadding}px`;
}

/**
 * Resets the padding-bottom of the messages container
 */
function resetMessagesPadding() {
    const nativeInput = document.querySelector(SELECTORS.NATIVE_INPUT);
    if (!nativeInput) return;
    
    const messagesContainer = findMessagesContainer(nativeInput);
    if (messagesContainer && messagesContainer.dataset.originalPadding !== undefined) {
        messagesContainer.style.paddingBottom = `${messagesContainer.dataset.originalPadding}px`;
    }
}

/**
 * Inserts text at the current cursor position of a textarea
 */
function insertTextAtCursor(textarea, text) {
    const startPos = textarea.selectionStart;
    const endPos = textarea.selectionEnd;
    const currentVal = textarea.value;
    
    textarea.value = currentVal.substring(0, startPos) + text + currentVal.substring(endPos);
    
    const newCursorPos = startPos + text.length;
    textarea.setSelectionRange(newCursorPos, newCursorPos);
}

/**
 * Retrieves the placeholder text from the native Draft.js wrapper
 */
function getPlaceholderText(editorRoot) {
    const placeholderEl = editorRoot.parentElement ? editorRoot.parentElement.querySelector('.public-DraftEditorPlaceholder-root') : null;
    if (placeholderEl) {
        return placeholderEl.textContent;
    }
    const nativeInput = editorRoot.querySelector(SELECTORS.NATIVE_INPUT) || editorRoot;
    if (nativeInput && nativeInput.getAttribute('placeholder')) {
        return nativeInput.getAttribute('placeholder');
    }
    return 'Send a message...';
}

// ==========================================
// 4. ALIGNMENT & THEME DETECTION
// ==========================================

function alignOverlay() {
    const nativeInput = document.querySelector(SELECTORS.NATIVE_INPUT);
    const overlay = document.getElementById('tiktok-chat-fix-container');
    
    if (!nativeInput || !overlay) {
        if (overlay) overlay.style.display = 'none';
        return;
    }

    const editorRoot = nativeInput.closest('.DraftEditor-root') || nativeInput;
    const rect = editorRoot.getBoundingClientRect();
    
    if (rect.width === 0 || rect.height === 0) {
        overlay.style.display = 'none';
        return;
    }

    overlay.style.display = 'flex';
    overlay.style.position = 'fixed';
    overlay.style.left = `${rect.left}px`;
    overlay.style.width = `${rect.width - 110}px`;

    let customHeight = overlay.offsetHeight || rect.height;
    const spamPanel = document.getElementById('tiktok-chat-fix-spam-panel');
    if (spamPanel && window.getComputedStyle(spamPanel).display === 'flex') {
        customHeight += spamPanel.offsetHeight;
    }
    const stickerPanel = document.getElementById('tiktok-chat-fix-sticker-panel');
    if (stickerPanel && window.getComputedStyle(stickerPanel).display === 'flex') {
        customHeight += stickerPanel.offsetHeight;
    }
    overlay.style.top = `${rect.bottom - (overlay.offsetHeight || rect.height)}px`;

    // Hide the native editor root visually, but preserve its layout/size in DOM
    if (!editorRoot.classList.contains('tiktok-native-input-hidden')) {
        editorRoot.classList.add('tiktok-native-input-hidden');
    }

    adjustMessagesPadding(nativeInput, rect.height, customHeight);
}

function syncTheme(overlay) {
    if (!overlay) {
        overlay = document.getElementById('tiktok-chat-fix-container');
    }
    if (!overlay) return;

    const htmlTheme = document.documentElement.getAttribute('data-theme') || '';
    const bodyClass = document.body.className || '';
    
    const isDarkTheme = htmlTheme.includes('dark') || 
                        bodyClass.includes('dark') || 
                        bodyClass.includes('theme-dark') ||
                        window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    let isDarkBg = false;
    try {
        const bodyBgColor = window.getComputedStyle(document.body).backgroundColor;
        const rgb = bodyBgColor.match(/\d+/g);
        if (rgb && rgb.length >= 3) {
            const r = parseInt(rgb[0]);
            const g = parseInt(rgb[1]);
            const b = parseInt(rgb[2]);
            const brightness = (r * 299 + g * 587 + b * 114) / 1000;
            if (brightness < 120) {
                isDarkBg = true;
            }
        }
    } catch (e) {}

    if (isDarkTheme || isDarkBg) {
        overlay.classList.add('dark');
    } else {
        overlay.classList.remove('dark');
    }
}

function setupThemeObserver(overlay) {
    if (themeObserver) {
        themeObserver.disconnect();
    }
    themeObserver = new MutationObserver(() => syncTheme(overlay));
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });
}

function setupLayoutSync(editorRoot) {
    cleanupLayoutSync();

    if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => alignOverlay());
        resizeObserver.observe(editorRoot);
    }

    window.addEventListener('resize', alignOverlay);
    window.addEventListener('scroll', alignOverlay, { passive: true });
    alignmentInterval = setInterval(alignOverlay, 100);
}

function cleanupLayoutSync() {
    if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
    }
    window.removeEventListener('resize', alignOverlay);
    window.removeEventListener('scroll', alignOverlay);
    if (alignmentInterval) {
        clearInterval(alignmentInterval);
        alignmentInterval = null;
    }
}

// ==========================================
// 5. ACTION & INJECTION LOGIC
// ==========================================

function updateSpamButtonUI(active) {
    const spamToggle = document.getElementById('tiktok-chat-fix-spam-toggle');
    if (!spamToggle) return;

    if (active) {
        spamToggle.innerHTML = '⏹️';
        spamToggle.title = 'Dừng Spam (ESC)';
        spamToggle.classList.add('active');
        spamToggle.style.color = '#ff9800';
    } else {
        spamToggle.innerHTML = '🔥';
        spamToggle.title = 'Bật/Tắt Bảng Điều Khiển Spam (Ctrl+Enter)';
        spamToggle.classList.remove('active');
        spamToggle.style.color = '';
    }
}

function waitForNativeSendButtonAndSend() {
    const selector = 'button[data-e2e="chat-send-button"], button[aria-label*="Send"], button[class*="ButtonSend"]';
    let attempts = 0;
    const maxAttempts = 50; // Tối đa 5 giây chờ upload ảnh

    const interval = setInterval(() => {
        const nativeSendBtn = document.querySelector(selector);
        attempts++;
        
        if (nativeSendBtn) {
            const isDisabled = nativeSendBtn.disabled || nativeSendBtn.getAttribute('disabled') !== null;
            if (!isDisabled) {
                nativeSendBtn.click();
                clearInterval(interval);
                return;
            }
        }
        
        if (attempts >= maxAttempts) {
            clearInterval(interval);
            // Fallback gửi qua phím Enter
            window.postMessage({
                source: 'tiktok-chat-fix-content',
                type: 'TRIGGER_ENTER'
            }, '*');
        }
    }, 100);
}

function handleSendMessage() {
    const textarea = document.getElementById('tiktok-chat-fix-textarea');
    if (!textarea) return;
    
    const text = textarea.value.trim();
    if (!text) return;

    // Immediately clear the textarea so the user can continue typing (like Messenger)
    textarea.value = '';
    textarea.style.height = 'auto';
    updateSendBtnState();
    alignOverlay();

    // Send the message instantly via the page context
    window.postMessage({
        source: 'tiktok-chat-fix-content',
        type: 'SEND_MESSAGE',
        text: text
    }, '*');

    // Instantly scroll messages container down
    const nativeInput = document.querySelector(SELECTORS.NATIVE_INPUT);
    if (nativeInput) {
        const messagesContainer = findMessagesContainer(nativeInput);
        if (messagesContainer) {
            setTimeout(() => {
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            }, 50);
        }
    }
}

async function handleSpamSend() {
    if (isSpamming) return;

    const textarea = document.getElementById('tiktok-chat-fix-textarea');
    if (!textarea) return;

    const text = textarea.value.trim();
    if (!text) return;

    const countInput = document.getElementById('tiktok-spam-count');
    const delayInput = document.getElementById('tiktok-spam-delay');
    
    const count = Math.min(99, Math.max(1, parseInt(countInput ? countInput.value : '5') || 5));
    const delay = Math.min(2000, Math.max(20, parseInt(delayInput ? delayInput.value : '80') || 80));

    // Immediately clear the textarea so it's ready
    textarea.value = '';
    textarea.style.height = 'auto';
    updateSendBtnState();
    alignOverlay();

    isSpamming = true;
    updateSpamButtonUI(true);

    // Trigger spam loop
    for (let i = 0; i < count; i++) {
        if (!isSpamming) {
            break;
        }

        window.postMessage({
            source: 'tiktok-chat-fix-content',
            type: 'SEND_MESSAGE',
            text: text
        }, '*');

        // Scroll down
        const nativeInput = document.querySelector(SELECTORS.NATIVE_INPUT);
        if (nativeInput) {
            const messagesContainer = findMessagesContainer(nativeInput);
            if (messagesContainer) {
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            }
        }

        if (i < count - 1) {
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    isSpamming = false;
    updateSpamButtonUI(false);
}

function updateSendBtnState() {
    const textarea = document.getElementById('tiktok-chat-fix-textarea');
    const sendBtn = document.getElementById('tiktok-chat-fix-send-btn');
    if (!textarea || !sendBtn) return;

    const hasText = textarea.value.trim().length > 0;
    sendBtn.disabled = !hasText;
    
    if (hasText) {
        sendBtn.classList.add('active');
    } else {
        sendBtn.classList.remove('active');
    }
}

// Sticker suggestions logic
function checkForStickerSuggestions() {
    const textarea = document.getElementById('tiktok-chat-fix-textarea');
    const stickerPanel = document.getElementById('tiktok-chat-fix-sticker-panel');
    if (!textarea || !stickerPanel) return;

    const text = textarea.value;
    if (!text.trim()) {
        stickerPanel.style.display = 'none';
        alignOverlay();
        return;
    }

    // Get the last typed word/segment
    const words = text.trim().toLowerCase().split(/\s+/);
    const lastWord = words[words.length - 1];

    let keyword = lastWord;
    if (SYNONYMS[keyword]) {
        keyword = SYNONYMS[keyword];
    }

    if (STICKER_MAP[keyword]) {
        const stickers = STICKER_MAP[keyword];
        stickerPanel.innerHTML = '';
        
        stickers.forEach(url => {
            const item = document.createElement('div');
            item.className = 'tiktok-chat-fix-sticker-item';
            item.title = `Gửi sticker cho từ "${lastWord}"`;
            item.innerHTML = `<img src="${url}" />`;
            
            item.addEventListener('click', (e) => {
                e.preventDefault();
                sendSticker(url, lastWord);
            });
            
            stickerPanel.appendChild(item);
        });

        stickerPanel.style.display = 'flex';
    } else {
        stickerPanel.style.display = 'none';
    }
    alignOverlay();
}

function sendSticker(url, keyword) {
    const textarea = document.getElementById('tiktok-chat-fix-textarea');
    const stickerPanel = document.getElementById('tiktok-chat-fix-sticker-panel');
    const nativeInput = document.querySelector(SELECTORS.NATIVE_INPUT);

    if (!nativeInput) return;

    if (stickerPanel) {
        stickerPanel.style.opacity = '0.5';
        stickerPanel.style.pointerEvents = 'none';
    }

    // Call background service worker to fetch the asset bypassing CSP
    chrome.runtime.sendMessage({ type: 'FETCH_STICKER', url: url }, (response) => {
        if (stickerPanel) {
            stickerPanel.style.opacity = '1';
            stickerPanel.style.pointerEvents = 'auto';
        }

        if (response && response.success) {
            if (stickerPanel) {
                stickerPanel.style.display = 'none';
            }

            // Convert Base64 dataURL to File
            const file = dataURLtoFile(response.dataUrl, 'sticker.gif');

            // Temporarily block focus redirect, target native, paste, then restore focus
            isFocusRedirectBlocked = true;
            nativeInput.focus();

            // Set selection on the native contenteditable so Draft.js receives paste
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(nativeInput);
            range.collapse(false);
            selection.removeAllRanges();
            selection.addRange(range);

            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);

            const pasteEvent = new ClipboardEvent('paste', {
                clipboardData: dataTransfer,
                bubbles: true,
                cancelable: true
            });

            nativeInput.dispatchEvent(pasteEvent);

            // Strip the keyword from the textarea
            if (textarea) {
                const val = textarea.value;
                const lastIndex = val.toLowerCase().lastIndexOf(keyword.toLowerCase());
                if (lastIndex !== -1) {
                    textarea.value = val.substring(0, lastIndex) + val.substring(lastIndex + keyword.length);
                }
                
                textarea.style.height = 'auto';
                textarea.style.height = `${textarea.scrollHeight}px`;
                updateSendBtnState();
            }

            // Chờ ảnh upload xong trên TikTok và tự động bấm gửi
            waitForNativeSendButtonAndSend();

            // Refocus custom textarea
            setTimeout(() => {
                if (textarea) textarea.focus();
                isFocusRedirectBlocked = false;
                alignOverlay();
            }, 250);

        } else {
            console.error('Failed to fetch sticker:', response ? response.error : 'Unknown error');
            isFocusRedirectBlocked = false;
        }
    });
}

function dataURLtoFile(dataurl, filename) {
    const arr = dataurl.split(',');
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], filename, { type: mime });
}

// ==========================================
// 6. SETUP & DOM INJECTION
// ==========================================

function createOverlay(editorRoot, nativeInput) {
    if (document.getElementById('tiktok-chat-fix-container')) return;

    const overlay = document.createElement('div');
    overlay.id = 'tiktok-chat-fix-container';
    overlay.className = 'tiktok-chat-fix-container';
    
    overlay.innerHTML = `
        <!-- Spam Settings Panel -->
        <div id="tiktok-chat-fix-spam-panel" class="tiktok-chat-fix-spam-panel">
            <span style="font-weight: 600; color: #ff9800; display: flex; align-items: center; gap: 2px;">
                🔥 Spam Mode
            </span>
            <span style="flex-grow: 1;"></span>
            <label>
                Count: 
                <input type="number" id="tiktok-spam-count" value="5" min="1" max="99" />
            </label>
            <label>
                Delay: 
                <input type="number" id="tiktok-spam-delay" value="80" min="20" max="2000" step="10" /> ms
            </label>
        </div>

        <!-- Sticker Suggestions Panel -->
        <div id="tiktok-chat-fix-sticker-panel" class="tiktok-chat-fix-sticker-panel">
            <!-- Populated dynamically via JS -->
        </div>

        <div class="tiktok-chat-fix-input-wrapper">
            <textarea id="tiktok-chat-fix-textarea" placeholder="${getPlaceholderText(editorRoot)}" rows="1"></textarea>
        </div>
        <!-- Spam Toggle Button -->
        <button id="tiktok-chat-fix-spam-toggle" class="tiktok-chat-fix-spam-toggle" title="Toggle Auto-Spam Panel (Ctrl+Enter to spam)">
            🔥
        </button>
        <!-- Send Button -->
        <button id="tiktok-chat-fix-send-btn" class="tiktok-chat-fix-send-btn" title="Send Message" disabled>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"></path>
            </svg>
        </button>
    `;

    document.body.appendChild(overlay);

    const textarea = document.getElementById('tiktok-chat-fix-textarea');
    const sendBtn = document.getElementById('tiktok-chat-fix-send-btn');
    const spamToggle = document.getElementById('tiktok-chat-fix-spam-toggle');
    const spamPanel = document.getElementById('tiktok-chat-fix-spam-panel');

    textarea.addEventListener('input', () => {
        textarea.style.height = 'auto';
        textarea.style.height = `${textarea.scrollHeight}px`;
        updateSendBtnState();
        checkForStickerSuggestions();
        alignOverlay();
    });

    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            if (e.ctrlKey || e.metaKey) {
                handleSpamSend();
            } else {
                handleSendMessage();
            }
        }
    });

    // Native input click/focus redirector (respects blocking)
    nativeInput.addEventListener('focus', () => {
        if (isFocusRedirectBlocked) return;
        setTimeout(() => {
            const txt = document.getElementById('tiktok-chat-fix-textarea');
            if (txt) txt.focus();
        }, 0);
    });

    sendBtn.addEventListener('click', (e) => {
        e.preventDefault();
        handleSendMessage();
    });

    spamToggle.addEventListener('click', (e) => {
        e.preventDefault();
        if (isSpamming) {
            isSpamming = false;
            updateSpamButtonUI(false);
            return;
        }
        const isVisible = window.getComputedStyle(spamPanel).display === 'flex';
        if (isVisible) {
            spamPanel.style.display = 'none';
            spamToggle.classList.remove('active');
        } else {
            spamPanel.style.display = 'flex';
            spamToggle.classList.add('active');
        }
        alignOverlay();
        textarea.focus();
    });

    // Listen for Escape key to stop spam
    if (escapeListener) {
        document.removeEventListener('keydown', escapeListener);
    }
    escapeListener = (e) => {
        if (e.key === 'Escape' && isSpamming) {
            isSpamming = false;
            updateSpamButtonUI(false);
        }
    };
    document.addEventListener('keydown', escapeListener);

    setupThemeObserver(overlay);
    syncTheme(overlay);
    setupNativeInputListeners(nativeInput, textarea);
}

/**
 * Monitors the native input for emoji picker clicks using a standard 'input' event,
 * replacing the loop-prone MutationObserver entirely.
 */
function setupNativeInputListeners(nativeInput, customTextarea) {
    // Sync emoji/stickers inserted from native TikTok picker
    nativeInput.addEventListener('input', () => {
        const nativeText = nativeInput.textContent || '';
        // Clean out zero-width spaces (\u200B)
        const cleanedText = nativeText.replace(/[\u200B]/g, '');
        
        if (cleanedText) {
            // Insert emoji at custom cursor position
            insertTextAtCursor(customTextarea, cleanedText);
            
            // Silently clear native input in page context (no focus changes)
            window.postMessage({
                source: 'tiktok-chat-fix-content',
                type: 'CLEAR_INPUT'
            }, '*');
            
            // Adjust overlay height
            customTextarea.style.height = 'auto';
            customTextarea.style.height = `${customTextarea.scrollHeight}px`;
            
            updateSendBtnState();
            alignOverlay();
            customTextarea.focus();
        }
    });
}

function cleanupCustomElements() {
    cleanupLayoutSync();
    resetMessagesPadding();

    const overlay = document.getElementById('tiktok-chat-fix-container');
    if (overlay) {
        overlay.remove();
    }

    if (themeObserver) {
        themeObserver.disconnect();
        themeObserver = null;
    }

    if (escapeListener) {
        document.removeEventListener('keydown', escapeListener);
        escapeListener = null;
    }

    activeNativeInput = null;
    isSpamming = false;

    document.querySelectorAll('.tiktok-native-input-hidden').forEach(el => {
        el.classList.remove('tiktok-native-input-hidden');
    });
}

function checkAndSetupFix() {
    if (!isMessagesPage()) {
        cleanupCustomElements();
        return;
    }

    const nativeInput = document.querySelector(SELECTORS.NATIVE_INPUT);
    if (!nativeInput) {
        cleanupCustomElements();
        return;
    }

    const editorRoot = nativeInput.closest('.DraftEditor-root') || nativeInput;

    if (activeNativeInput !== nativeInput || !document.getElementById('tiktok-chat-fix-container')) {
        cleanupCustomElements();
        activeNativeInput = nativeInput;
        createOverlay(editorRoot, nativeInput);
        alignOverlay();
        setupLayoutSync(editorRoot);
    }
}

/**
 * Extension entry point
 */
function initExtension() {
    // Inject page-context helper script (inject.js)
    try {
        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('inject.js');
        (document.head || document.documentElement).appendChild(script);
    } catch (e) {
        console.error('TikTok Chat Fixer: Failed to inject script.', e);
    }

    // Watch for SPA route changes
    setInterval(() => {
        if (window.location.href !== currentUrl) {
            currentUrl = window.location.href;
            checkAndSetupFix();
        }
    }, 500);

    checkAndSetupFix();

    // Watch DOM mutations to handle lazy rendering of chat area
    domObserver = new MutationObserver((mutations) => {
        let shouldCheck = false;
        for (const mutation of mutations) {
            if (mutation.addedNodes.length > 0) {
                shouldCheck = true;
                break;
            }
        }
        if (shouldCheck) {
            checkAndSetupFix();
        }
    });

    domObserver.observe(document.body, { childList: true, subtree: true });
}

// Run the extension
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initExtension);
} else {
    initExtension();
}
