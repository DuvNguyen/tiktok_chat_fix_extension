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

                // Dispatch Enter key after a 10ms timeout to allow React to finish batching the state update
                setTimeout(() => {
                    const enterEvent = new KeyboardEvent('keydown', {
                        key: 'Enter',
                        keyCode: 13,
                        code: 'Enter',
                        which: 13,
                        bubbles: true,
                        cancelable: true
                    });
                    nativeInput.dispatchEvent(enterEvent);
                }, 10);

            } catch (err) {
                console.error('TikTok Chat Fixer: Direct send error:', err);
            }
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
    });

    console.log('TikTok Chat Fixer: Injected script listeners registered.');
})();
