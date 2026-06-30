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

    const customHeight = overlay.offsetHeight || rect.height;
    overlay.style.top = `${rect.bottom - customHeight}px`;

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

// ==========================================
// 6. SETUP & DOM INJECTION
// ==========================================

function createOverlay(editorRoot, nativeInput) {
    if (document.getElementById('tiktok-chat-fix-container')) return;

    const overlay = document.createElement('div');
    overlay.id = 'tiktok-chat-fix-container';
    overlay.className = 'tiktok-chat-fix-container';
    
    overlay.innerHTML = `
        <div class="tiktok-chat-fix-input-wrapper">
            <textarea id="tiktok-chat-fix-textarea" placeholder="${getPlaceholderText(editorRoot)}" rows="1"></textarea>
        </div>
        <button id="tiktok-chat-fix-send-btn" class="tiktok-chat-fix-send-btn" title="Send Message" disabled>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"></path>
            </svg>
        </button>
    `;

    document.body.appendChild(overlay);

    const textarea = document.getElementById('tiktok-chat-fix-textarea');
    const sendBtn = document.getElementById('tiktok-chat-fix-send-btn');

    textarea.addEventListener('input', () => {
        textarea.style.height = 'auto';
        textarea.style.height = `${textarea.scrollHeight}px`;
        updateSendBtnState();
        alignOverlay();
    });

    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            handleSendMessage();
        }
    });

    // Native input click/focus redirector
    nativeInput.addEventListener('focus', () => {
        setTimeout(() => {
            const txt = document.getElementById('tiktok-chat-fix-textarea');
            if (txt) txt.focus();
        }, 0);
    });

    sendBtn.addEventListener('click', (e) => {
        e.preventDefault();
        handleSendMessage();
    });

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

    activeNativeInput = null;

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
