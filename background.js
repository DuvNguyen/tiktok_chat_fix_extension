/**
 * TikTok Chat Typing Fixer - Background Service Worker
 * 
 * Used to bypass Content Security Policy (CSP) and CORS restrictions of TikTok.
 * Fetches sticker media (GIF/WebP) and returns it as a base64 Data URL.
 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'FETCH_STICKER') {
        fetch(message.url)
            .then(response => response.blob())
            .then(blob => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    sendResponse({ success: true, dataUrl: reader.result });
                };
                reader.onerror = (err) => {
                    sendResponse({ success: false, error: err.message });
                };
                reader.readAsDataURL(blob);
            })
            .catch(err => {
                sendResponse({ success: false, error: err.message });
            });
        return true; // Keep message channel open for async response
    }
});
