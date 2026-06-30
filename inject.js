/**
 * TikTok Chat Typing Fixer - Page Context Inject Script
 * 
 * Runs directly in the main page context of TikTok.
 * Directly modifies React Fiber & Draft.js state for instantaneous, non-crashing operations.
 */

(function() {
    console.log('TikTok Chat Fixer: Injected script initialized.');

    // Helper to find React Fiber / Props key on a DOM node
    function getReactKey(node) {
        if (!node) return null;
        return Object.keys(node).find(key => key.startsWith('__reactFiber$') || key.startsWith('__reactProps$'));
    }

    // Traverse fiber tree up from a node to find the Editor component props
    function findEditorProps(node) {
        const key = getReactKey(node);
        if (!key) return null;

        let current = node[key];
        while (current) {
            const props = current.memoizedProps;
            if (props && props.editorState && typeof props.onChange === 'function') {
                return { props: props, fiber: current };
            }
            if (current.stateNode && current.stateNode.props && current.stateNode.props.editorState && typeof current.stateNode.props.onChange === 'function') {
                return { props: current.stateNode.props, fiber: current };
            }
            current = current.return;
        }
        return null;
    }

    // Listen to messages from content.js
    window.addEventListener('message', function(event) {
        if (event.source !== window || !event.data || event.data.source !== 'tiktok-chat-fix-content') {
            return;
        }

        const msg = event.data;

        // Message Sending Action
        if (msg.type === 'SEND_MESSAGE') {
            const text = msg.text;
            (async () => {
                const nativeInput = document.querySelector('div[contenteditable="true"].public-DraftEditor-content, div[contenteditable="true"]');
                if (!nativeInput) {
                    window.postMessage({ source: 'tiktok-chat-fix-inject', type: 'SEND_MESSAGE_ACK', success: false }, '*');
                    return;
                }

                let editorInfo = findEditorProps(nativeInput);
                if (!editorInfo) {
                    window.postMessage({ source: 'tiktok-chat-fix-inject', type: 'SEND_MESSAGE_ACK', success: false }, '*');
                    return;
                }

                try {
                    const { props } = editorInfo;
                    const currentEditorState = props.editorState;
                    
                    const EditorState = currentEditorState.constructor;
                    const currentContent = currentEditorState.getCurrentContent();
                    const ContentState = currentContent.constructor;

                    // Issue 2 Fix: Append a single trailing space
                    const processedText = text + ' ';
                    const newContentState = ContentState.createFromText(processedText);
                    
                    // Push the new content state to create the new editor state
                    let newEditorState = EditorState.push(currentEditorState, newContentState, 'insert-characters');
                    
                    // Force selection to end of the injected text
                    try {
                        const selection = currentEditorState.getSelection();
                        if (selection) {
                            const updatedSelection = selection.merge({
                                anchorOffset: processedText.length,
                                focusOffset: processedText.length,
                                isFocused: true
                            });
                            newEditorState = EditorState.forceSelection(newEditorState, updatedSelection);
                        }
                    } catch (e) {}

                    // Call the native onChange handler to update React State synchronously
                    props.onChange(newEditorState);

                    // Wait for React to apply the text change (up to 100ms)
                    let updated = false;
                    for (let attempt = 0; attempt < 20; attempt++) {
                        const info = findEditorProps(nativeInput);
                        if (info && info.props.editorState.getCurrentContent().getPlainText().trim() === text.trim()) {
                            updated = true;
                            break;
                        }
                        await new Promise(resolve => setTimeout(resolve, 5));
                    }

                    // Dispatch Enter key
                    const enterEvent = new KeyboardEvent('keydown', {
                        key: 'Enter',
                        keyCode: 13,
                        code: 'Enter',
                        which: 13,
                        bubbles: true,
                        cancelable: true
                    });
                    nativeInput.dispatchEvent(enterEvent);

                    // Wait for the input to be cleared by TikTok's handler (up to 500ms)
                    let cleared = false;
                    for (let attempt = 0; attempt < 100; attempt++) {
                        const info = findEditorProps(nativeInput);
                        const plainText = info ? info.props.editorState.getCurrentContent().getPlainText().trim() : "";
                        if (plainText === "" && nativeInput.textContent.trim() === "") {
                            cleared = true;
                            break;
                        }
                        await new Promise(resolve => setTimeout(resolve, 5));
                    }

                    window.postMessage({ source: 'tiktok-chat-fix-inject', type: 'SEND_MESSAGE_ACK', success: cleared }, '*');

                } catch (err) {
                    console.error('TikTok Chat Fixer: Direct send error:', err);
                    window.postMessage({ source: 'tiktok-chat-fix-inject', type: 'SEND_MESSAGE_ACK', success: false }, '*');
                }
            })();
        }

        // Silent Clear Action
        if (msg.type === 'CLEAR_INPUT') {
            const nativeInput = document.querySelector('div[contenteditable="true"].public-DraftEditor-content, div[contenteditable="true"]');
            if (!nativeInput) return;

            const editorInfo = findEditorProps(nativeInput);
            if (!editorInfo) return;

            try {
                const { props } = editorInfo;
                const currentEditorState = props.editorState;
                
                const EditorState = currentEditorState.constructor;
                const currentContent = currentEditorState.getCurrentContent();
                const ContentState = currentContent.constructor;

                const newContentState = ContentState.createFromText('');
                const newEditorState = EditorState.push(currentEditorState, newContentState, 'remove-range');
                
                props.onChange(newEditorState);
            } catch (err) {
                console.error('TikTok Chat Fixer: Direct clear error:', err);
            }
        }

        // Trigger Enter Action (Fallback)
        if (msg.type === 'TRIGGER_ENTER') {
            const nativeInput = document.querySelector('div[contenteditable="true"].public-DraftEditor-content, div[contenteditable="true"]');
            if (!nativeInput) return;
            try {
                const enterEvent = new KeyboardEvent('keydown', {
                    key: 'Enter',
                    keyCode: 13,
                    code: 'Enter',
                    which: 13,
                    bubbles: true,
                    cancelable: true
                });
                nativeInput.dispatchEvent(enterEvent);
            } catch (err) {
                console.error('TikTok Chat Fixer: Trigger enter error:', err);
            }
        }
    });

    console.log('TikTok Chat Fixer: Injected script listeners registered.');
})();
