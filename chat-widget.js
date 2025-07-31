class ChatWidget {
    constructor() {
        this.isOpen = false;
        this.messages = [];
        this.webhookUrl = 'https://n8n.3dsmilesolutions.ai/webhook/omnidentai';
        this.formWebhookUrl = 'https://n8n.3dsmilesolutions.ai/webhook/form-submit';
        this.metricsWebhookUrl = 'https://n8n.3dsmilesolutions.ai/webhook/extract-metrics';
        this.codeVerificationUrl = 'https://n8n.3dsmilesolutions.ai/webhook/verify-code';
        this.isSending = false;
        this.maxStoredMessages = 100;
        this.messageExpiryDays = 30;

        // Session management
        this.currentSessionId = null;
        this.sessionStartTime = null;
        this.inactivityTimeout = null;
        this.inactivityDuration = 2 * 60 * 1000; // 30 minutes
        this.sessionActive = false;

        // Message pagination
        this.messagesOffset = 0;
        this.messageLimit = 25;
        this.hasMoreMessages = true;
        this.isLoadingMore = false;

        // Supabase configuration
        this.supabaseUrl = 'https://qdrxmkfcajqenzdxejhp.supabase.co'; // Replace with your actual URL
        this.supabaseKey = 'sb_publishable_QKwYCf7_uuRqSIzIopv91A_Y_kjKsho'; // Replace with your actual key
        this.supabase = null;
        this.isSupabaseEnabled = false;


        // Add these new properties for resend timer
        this.resendCooldown = false;
        this.resendTimer = null;
        this.resendCountdown = 60;

        // Add sound properties
       this.soundsEnabled = true;
       this.isFirstLoad = true; // Add this flag

        // Add these new properties for polling
        this.messagePollingInterval = null;
        this.pollingActive = false;



        this.init();
    }

    // 2. Add this method to initialize sounds
    // 2. Replace initSounds() with this simple version
    initSounds() {
    // Just enable sounds - we'll create audio context when needed
    this.soundsEnabled = true;
    console.log('Sounds enabled');
}

// 3. Replace playSound() with this complete working version
    playSound(type) {
    if (!this.soundsEnabled || this.isFirstLoad) return; // Skip if first load

    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        if (type === 'send') {
            // Very quiet send sound
            oscillator.frequency.value = 1200;
            gainNode.gain.setValueAtTime(0.20, audioContext.currentTime); // Much quieter
            gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.05); // Shorter too
            oscillator.start();
            oscillator.stop(audioContext.currentTime + 0.05);
        } else if (type === 'receive') {
            // Very quiet, pleasant receive sound
            oscillator.frequency.value = 800; // Lower frequency, less harsh
            gainNode.gain.setValueAtTime(0.08, audioContext.currentTime); // Very quiet
            gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.15); // Shorter duration
            oscillator.start();
            oscillator.stop(audioContext.currentTime + 0.15);
        }

    } catch (error) {
        console.warn('Sound failed:', error);
    }
}

// Add this helper method to get the marketing consent value
getMarketingConsent() {
    const consentCheckbox = document.querySelector('input[name="marketingConsent"]');
    return consentCheckbox ? consentCheckbox.checked : false;
}

// Add these functions to your existing JavaScript
showConsentError() {
    document.getElementById('consentError').style.display = 'block';
}

hideConsentError() {
    if (document.getElementById('marketingConsent').checked) {
        document.getElementById('consentError').style.display = 'none';
    }
}

async saveUserProfile(userData) {
    if (!this.isSupabaseEnabled) {
        console.log('Supabase not enabled, skipping profile save');
        return false;
    }

    const contactId = localStorage.getItem('ghl_contact_id');
    if (!contactId) {
        console.warn('No contact ID available for profile save');
        return false;
    }

    try {
        // Set user context first
        await this.setUserContext(contactId);

        const profileData = {
            contact_id: contactId,
            email: userData.email,
            first_name: userData.name?.split(' ')[0] || '',
            last_name: userData.name?.split(' ').slice(1).join(' ') || '',
            phone: userData.phone || '',
            zip_code: userData.zipCode || '',
            gender: userData.gender || '',
            age: userData.age ? parseInt(userData.age) : null,
            marketing_consent: userData.marketingConsent || false,
            updated_at: new Date().toISOString()
        };

        // Use upsert to insert or update
        const { data, error } = await this.supabase
            .from('user_profiles')
            .upsert(profileData, {
                onConflict: 'contact_id',
                ignoreDuplicates: false
            })
            .select();

        if (error) {
            console.error('Error saving user profile:', error);
            return false;
        }

        // console.log('User profile saved successfully:', data);
        return true;
    } catch (error) {
        console.error('Error in saveUserProfile:', error);
        return false;
    }
}

async loadUserProfile() {
    if (!this.isSupabaseEnabled) {
        console.log('Supabase not enabled, skipping profile load');
        return null;
    }

    const contactId = localStorage.getItem('ghl_contact_id');
    if (!contactId) {
        console.warn('No contact ID available for profile load');
        return null;
    }

    try {
        // Set user context first
        await this.setUserContext(contactId);

        const { data, error } = await this.supabase
            .from('user_profiles')
            .select('*')
            .eq('contact_id', contactId)
            .single();

        if (error) {
            if (error.code !== 'PGRST116') { // Not found error
                console.error('Error loading user profile:', error);
            }
            return null;
        }

        // console.log('User profile loaded successfully:', data);
        return data;
    } catch (error) {
        console.error('Error in loadUserProfile:', error);
        return null;
    }
}

parseMarkdownLinks(text) {
    // Simple regex to convert [text](url) to clickable links
    return text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" style="color: rgb(17,35,89); text-decoration: underline; font-weight: 600;">$1</a>');
}

// Start polling for incoming messages
startIncomingMessagePolling() {
    const contactId = localStorage.getItem('ghl_contact_id');
    if (!contactId || this.messagePollingInterval || !this.isSupabaseEnabled) return;

    // console.log('Starting message polling for:', contactId);
    this.pollingActive = true;

    this.messagePollingInterval = setInterval(async () => {
        if (this.pollingActive) {
            await this.checkForIncomingMessages();
        }
    }, 2000); // Poll every 2 seconds

    // Check immediately
    this.checkForIncomingMessages();
}

// Check for undelivered messages
async checkForIncomingMessages() {
    const contactId = localStorage.getItem('ghl_contact_id');
    if (!contactId || !this.isSupabaseEnabled || !this.pollingActive) return;

    // Prevent multiple simultaneous checks
    if (this.isCheckingMessages) return;
    this.isCheckingMessages = true;

    try {
        await this.setUserContext(contactId);

        // Only get messages from the last 30 seconds (very recent)
        const thirtySecondsAgo = new Date(Date.now() - 30 * 1000).toISOString();

        const { data, error } = await this.supabase
            .from('chat_messages')
            .select('*')
            .eq('contact_id', contactId)
            .eq('delivered', false)
            .eq('sender', 'bot')
            .gte('created_at', thirtySecondsAgo)  // Only last 30 seconds
            .order('created_at', { ascending: false })  // Newest first
            .limit(1);  // Only get the most recent one

        if (error) {
            console.warn('Error checking for incoming messages:', error);
            return;
        }

        if (data && data.length > 0) {
            const latestMessage = data[0];
            // console.log(`Found new message: ${latestMessage.id}`);

            // Add to chat display
            this.addMessageToDOM(latestMessage.message, 'bot', latestMessage.created_at);

            // Show notification if chat is closed
            if (!this.isOpen) {
                this.showNewMessageNotification();
            }

            // Immediately mark as delivered
            await this.markMessageDelivered(latestMessage.id);

            if (this.isOpen) {
                this.scrollToBottom();
            }
        }
    } catch (error) {
        console.warn('Error in checkForIncomingMessages:', error);
    } finally {
        this.isCheckingMessages = false;
    }
}

// Mark message as delivered
async markMessageDelivered(messageId) {
    try {
        const contactId = localStorage.getItem('ghl_contact_id');
        await this.setUserContext(contactId);

        const { error } = await this.supabase
            .from('chat_messages')
            .update({ delivered: true })
            .eq('id', messageId);

        if (error) {
            console.warn('Error marking message as delivered:', error);
        }
    } catch (error) {
        console.warn('Error in markMessageDelivered:', error);
    }
}

// Show notification for new messages
showNewMessageNotification() {
    if (this.messagePrompt) {
        this.messagePrompt.textContent = "New message! 💬";
        this.messagePrompt.classList.remove('hidden');

        // Animate the chat button
        this.chatButton.style.animation = 'chatButtonGlow 1s ease-in-out 3';

        setTimeout(() => {
            this.chatButton.style.animation = '';
        }, 3000);
    }
}

// Stop polling
stopIncomingMessagePolling() {
    this.pollingActive = false;

    if (this.messagePollingInterval) {
        clearInterval(this.messagePollingInterval);
        this.messagePollingInterval = null;
        console.log('Stopped message polling');
    }
}

    async init() {
        // Initialize Supabase
        await this.initSupabase();

        this.chatButton = document.getElementById('chatButton');
        this.chatWindow = document.getElementById('chatWindow');
        this.closeBtn = document.getElementById('closeBtn');
        this.chatInput = document.getElementById('chatInput');
        this.sendBtn = document.getElementById('sendBtn');
        this.chatMessages = document.getElementById('chatMessages');
        this.messagePrompt = document.getElementById('messagePrompt');

        // Form elements
        this.formOverlay = document.getElementById('chatFormOverlay'); // This should be the overlay div
        this.chatForm = document.getElementById('chatForm');
        this.formLoading = document.getElementById('formLoading');
        this.formSubmitBtn = document.getElementById('formSubmitBtn');

        // Load more messages elements
        this.loadMoreContainer = null;
        this.loadMoreBtn = null;
        this.createLoadMoreButton();

        this.bindEvents();
        this.setupFormHandlers();
    }

    async initSupabase() {
        try {
            // Only initialize if URLs are properly configured
            if (this.supabaseUrl !== 'YOUR_SUPABASE_URL' && this.supabaseKey !== 'YOUR_SUPABASE_ANON_KEY') {
                this.supabase = window.supabase.createClient(this.supabaseUrl, this.supabaseKey);
                this.isSupabaseEnabled = true;
                // console.log('Supabase initialized successfully');
            } else {
                console.log('Supabase not configured - using localStorage fallback');
                this.isSupabaseEnabled = false;
            }
        } catch (error) {
            console.warn('Supabase initialization failed, using localStorage fallback:', error);
            this.isSupabaseEnabled = false;
        }
    }

    // Session Management Methods
    generateSessionId() {
        const contactId = localStorage.getItem('ghl_contact_id');
        const timestamp = Date.now();
        return `${contactId || 'temp'}_session_${timestamp}`;
    }

    startNewSession() {
        this.currentSessionId = this.generateSessionId();
        this.sessionStartTime = new Date().toISOString();
        this.sessionActive = true;

        sessionStorage.setItem('current_session_id', this.currentSessionId);
        sessionStorage.setItem('session_start_time', this.sessionStartTime);
        sessionStorage.setItem('session_active', 'true');

        // console.log('New session started:', this.currentSessionId);
        this.resetInactivityTimer();
    }

    getCurrentSessionId() {
        if (!this.currentSessionId) {
            this.currentSessionId = sessionStorage.getItem('current_session_id');
        }
        return this.currentSessionId;
    }

    resetInactivityTimer() {
        if (this.inactivityTimeout) {
            clearTimeout(this.inactivityTimeout);
        }

        this.inactivityTimeout = setTimeout(() => {
            this.handleSessionTimeout();
        }, this.inactivityDuration);
    }

    async handleSessionTimeout() {
    if (!this.sessionActive) return;

    console.log('Session timed out due to inactivity');
    await this.endCurrentSession('inactivity_timeout');

    // Show session ended message WITHOUT the button
    await this.addSystemMessage(
        '⏰ This conversation has ended due to inactivity. Send a message to start a new conversation.',
        false // No button
    );
}

    async endCurrentSession(reason = 'manual') {
        if (!this.sessionActive || !this.currentSessionId) return;

        const sessionEndTime = new Date().toISOString();
        this.sessionActive = false;

        // Clear inactivity timer
        if (this.inactivityTimeout) {
            clearTimeout(this.inactivityTimeout);
            this.inactivityTimeout = null;
        }

        // Trigger metrics extraction
        await this.triggerMetricsExtraction(
            this.currentSessionId,
            localStorage.getItem('ghl_contact_id'),
            this.sessionStartTime,
            sessionEndTime,
            reason
        );

        // Clear session data
        sessionStorage.removeItem('current_session_id');
        sessionStorage.removeItem('session_start_time');
        sessionStorage.removeItem('session_active');

        this.currentSessionId = null;
        this.sessionStartTime = null;

        console.log('Session ended:', reason);
    }

    async triggerMetricsExtraction(sessionId, contactId, startTime, endTime, endReason) {
        if (!sessionId || !contactId) return;

        try {
            const response = await fetch(this.metricsWebhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: sessionId,
                    contact_id: contactId,
                    session_start_time: startTime,
                    session_end_time: endTime,
                    end_reason: endReason,
                    message_count: this.messages.length
                })
            });

            if (response.ok) {
                console.log('Metrics extraction triggered successfully');
            } else {
                console.warn('Failed to trigger metrics extraction:', response.status);
            }
        } catch (error) {
            console.warn('Error triggering metrics extraction:', error);
        }
    }

    createLoadMoreButton() {
        // Create load more container and button
        this.loadMoreContainer = document.createElement('div');
        this.loadMoreContainer.id = 'loadMoreContainer';
        this.loadMoreContainer.style.display = 'none';
        this.loadMoreContainer.style.textAlign = 'center';
        this.loadMoreContainer.style.padding = '10px';
        this.loadMoreContainer.style.borderBottom = '1px solid #e2e8f0';

        this.loadMoreBtn = document.createElement('button');
        this.loadMoreBtn.id = 'loadMoreBtn';
        this.loadMoreBtn.textContent = 'Load Earlier Messages';
        this.loadMoreBtn.style.cssText = `
            background: linear-gradient(135deg, #34d399 0%, #10b981 100%);
            color: #112359;
            border: none;
            padding: 8px 16px;
            border-radius: 12px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
        `;

        this.loadMoreBtn.addEventListener('mouseenter', () => {
            this.loadMoreBtn.style.transform = 'translateY(-1px)';
            this.loadMoreBtn.style.boxShadow = '0 4px 12px rgba(52, 211, 153, 0.3)';
        });

        this.loadMoreBtn.addEventListener('mouseleave', () => {
            this.loadMoreBtn.style.transform = 'translateY(0)';
            this.loadMoreBtn.style.boxShadow = 'none';
        });

        this.loadMoreBtn.addEventListener('click', () => this.loadMoreMessages());

        this.loadMoreContainer.appendChild(this.loadMoreBtn);

        // Insert at the beginning of chat messages
        if (this.chatMessages) {
            this.chatMessages.insertBefore(this.loadMoreContainer, this.chatMessages.firstChild);
        }
    }

    async loadMoreMessages() {
        if (this.isLoadingMore || !this.hasMoreMessages) return;

        this.isLoadingMore = true;
        this.loadMoreBtn.textContent = 'Loading...';
        this.loadMoreBtn.disabled = true;

        try {
            const contactId = localStorage.getItem('ghl_contact_id');
            if (!contactId) return;

            // ADD THIS LINE - Set user context before querying
            await this.setUserContext(contactId);

            // Calculate new offset
            const newOffset = this.messagesOffset + this.messageLimit;

            // Load more messages from Supabase
            const { data, error } = await this.supabase
                .from('chat_messages')
                .select('*')
                .eq('contact_id', contactId)
                .order('created_at', { ascending: false })
                .range(newOffset, newOffset + this.messageLimit - 1);

            if (error) throw error;

            if (data && data.length > 0) {
                // Store current scroll position
                const scrollHeight = this.chatMessages.scrollHeight;
                const scrollTop = this.chatMessages.scrollTop;

                // Reverse to maintain chronological order (oldest to newest)
                const olderMessages = data.reverse();

                // Add older messages to the beginning of the messages array
                const newMessages = olderMessages.map(msg => ({
                    content: msg.message,
                    sender: msg.sender,
                    timestamp: msg.created_at,
                    sessionId: msg.session_id
                }));

                this.messages = [...newMessages, ...this.messages];

                // Add older messages to DOM (at the beginning)
                olderMessages.forEach(msg => {
                    this.addMessageToDOM(msg.message, msg.sender, msg.created_at, true);
                });

                // Restore scroll position relative to new content
                const newScrollHeight = this.chatMessages.scrollHeight;
                this.chatMessages.scrollTop = scrollTop + (newScrollHeight - scrollHeight);

                // Update offset
                this.messagesOffset = newOffset;

                // Check if there are more messages
                if (data.length < this.messageLimit) {
                    this.hasMoreMessages = false;
                    this.loadMoreContainer.style.display = 'none';
                }

                console.log(`Loaded ${data.length} more messages. Total: ${this.messages.length}`);
            } else {
                // No more messages
                this.hasMoreMessages = false;
                this.loadMoreContainer.style.display = 'none';
            }

        } catch (error) {
            console.warn('Error loading more messages:', error);
        } finally {
            this.isLoadingMore = false;
            this.loadMoreBtn.textContent = 'Load Earlier Messages';
            this.loadMoreBtn.disabled = false;
        }
    }

    async setUserContext(contactId) {
    const email = localStorage.getItem('user_email');

    if (!this.isSupabaseEnabled) {
        console.log('Supabase not enabled');
        return true;
    }

    if (!contactId || !email) {
        console.error('Missing credentials for setUserContext:', { contactId, email });
        return false;
    }

    try {
        // console.log('Setting user context for:', contactId, email);

        const { data, error } = await this.supabase.rpc('set_user_context', {
            contact_id: contactId,
            email: email
        });

        if (error) {
            console.error('Failed to set user context:', error);
            return false;
        }

        // console.log('User context set successfully, result:', data);

        // Verify the context was set by immediately checking it
        const verification = await this.debugRLSContext();
        if (verification && (verification.current_contact_id === '' || verification.current_user_email === '')) {
            console.error('Context verification failed - values are empty');
            return false;
        }

        return true;
    } catch (error) {
        console.error('Error setting user context:', error);
        return false;
    }
}


    // Enhanced message loading with pagination
    async loadChatHistory() {
        const contactId = localStorage.getItem('ghl_contact_id');
        if (!contactId) return;

        // Reset pagination state
        this.messagesOffset = 0;
        this.hasMoreMessages = true;
        this.loadMoreContainer.style.display = 'none';

        // Set user context first
        await this.setUserContext(contactId);

        if (this.isSupabaseEnabled) {
            try {
                await this.loadFromSupabase(contactId);
            } catch (error) {
                console.warn('Supabase loading failed, using localStorage:', error);
                this.loadFromLocalStorage(contactId);
            }
        } else {
            this.loadFromLocalStorage(contactId);
        }
        // Enable sounds after first load is complete
    this.isFirstLoad = false;
    }


    async loadFromSupabase(contactId) {
        const { data, error } = await this.supabase
            .from('chat_messages')
            .select('*')
            .eq('contact_id', contactId)
            .order('created_at', { ascending: false })
            .range(0, this.messageLimit - 1);

        if (error) {
            throw error;
        }

        if (data && data.length > 0) {
            // Reverse to show oldest→newest in UI
            const recentMessages = data.reverse();

            this.messages = recentMessages.map(msg => ({
                content: msg.message,
                sender: msg.sender,
                timestamp: msg.created_at,
                sessionId: msg.session_id
            }));

            // Display messages in DOM
            this.messages.forEach(msg => {
                this.addMessageToDOM(msg.content, msg.sender, msg.timestamp);
            });

            // Show load more button if we got a full batch (suggesting more messages exist)
            if (data.length === this.messageLimit) {
                this.loadMoreContainer.style.display = 'block';
            }

            // console.log(`Loaded ${this.messages.length} recent messages from Supabase`);
        } else {
            this.messages = [];
            console.log('No messages found in Supabase');
        }
    }

    loadFromLocalStorage(contactId) {
        const storageKey = `chat_messages_${contactId}`;
        const storedData = localStorage.getItem(storageKey);

        if (storedData) {
            try {
                const parsedData = JSON.parse(storedData);

                if (this.areMessagesExpired(parsedData.timestamp)) {
                    this.clearChatHistory();
                    return;
                }

                this.messages = parsedData.messages || [];
                this.messages.forEach(msg => {
                    this.addMessageToDOM(msg.content, msg.sender, msg.timestamp);
                });

                console.log(`Loaded ${this.messages.length} messages from localStorage`);
            } catch (error) {
                console.warn('Error loading from localStorage:', error);
                this.clearChatHistory();
            }
        }
    }

    // Enhanced message saving with Supabase integration
    async saveChatHistory() {
        const contactId = localStorage.getItem('ghl_contact_id');
        if (!contactId) return;

        if (this.isSupabaseEnabled) {
            // Save to Supabase happens automatically when addMessage is called
            // This method now just handles localStorage backup
            this.saveToLocalStorage(contactId);
        } else {
            this.saveToLocalStorage(contactId);
        }
    }

    saveToLocalStorage(contactId) {
        const storageKey = `chat_messages_${contactId}`;
        const messagesToStore = this.messages.slice(-this.maxStoredMessages);

        const dataToStore = {
            messages: messagesToStore,
            timestamp: new Date().toISOString(),
            contactId: contactId
        };

        try {
            localStorage.setItem(storageKey, JSON.stringify(dataToStore));
        } catch (error) {
            console.warn('Error saving to localStorage:', error);
            this.cleanupOldChatHistory();
            try {
                localStorage.setItem(storageKey, JSON.stringify(dataToStore));
            } catch (secondError) {
                console.error('Failed to save to localStorage even after cleanup:', secondError);
            }
        }
    }

    // Enhanced addMessage with Supabase integration and session tracking
    // 4. Update your addMessage method to include sounds
async addMessage(content, sender) {
    const timestamp = new Date().toISOString();
    this.addMessageToDOM(content, sender, timestamp);

    const message = {
        content,
        sender,
        timestamp,
        sessionId: this.getCurrentSessionId()
    };

    this.messages.push(message);

    // Play sound for user messages only here
    if (sender === 'user') {
        this.playSound('send');
    }
    // Bot sounds are handled in addMessageToDOM for new messages only

    // Save to Supabase if enabled
    if (this.isSupabaseEnabled) {
        await this.saveMessageToSupabase(content, sender, timestamp);
    }

    // Always save to localStorage as backup
    this.saveChatHistory();

    // Reset inactivity timer on user messages
    if (sender === 'user' && this.sessionActive) {
        this.resetInactivityTimer();
    }
}


    async addSystemMessage(content, showNewSessionButton = false) {
        const timestamp = new Date().toISOString();
        this.addSystemMessageToDOM(content, timestamp, showNewSessionButton);
    }

    // Enhanced saveMessageToSupabase with RLS debugging
async saveMessageToSupabase(content, sender, timestamp) {
    const contactId = localStorage.getItem('ghl_contact_id');
    const email = localStorage.getItem('user_email');

    if (!contactId || !email) {
        console.warn('Missing contact ID or email for message save');
        return;
    }

    try {
        // Set context immediately before saving
        const contextSet = await this.setUserContext(contactId);
        if (!contextSet) {
            console.error('Failed to set context before message save');
            return;
        }

        // Small delay to ensure context propagates
        await new Promise(resolve => setTimeout(resolve, 50));

        const { error } = await this.supabase
            .from('chat_messages')
            .insert({
                contact_id: contactId,
                user_email: email,
                session_id: this.getCurrentSessionId(),
                message: content,
                sender: sender,
                channel: 'webchat',
                created_at: timestamp
            });

        if (error) {
            console.warn('Failed to save message to Supabase:', error);

            // REMOVE THE OLD VALIDATION CALLS - they're causing 404 errors
            // Just log the debug info
            const debugInfo = await this.debugRLSContext();
            console.log('RLS Debug Info:', debugInfo);
        } else {
            // console.log('Message saved to Supabase successfully');
        }
    } catch (error) {
        console.warn('Error saving to Supabase:', error);
    }
}


// Add the missing debugRLSContext method
async debugRLSContext() {
    if (!this.isSupabaseEnabled) {
        console.log('Supabase not enabled');
        return null;
    }

    try {
        const { data, error } = await this.supabase.rpc('debug_rls_context');

        if (error) {
            console.error('RLS debug error:', error);
            return null;
        }

        // console.log('=== RLS CONTEXT ===');
        // console.log('Contact ID:', data.current_contact_id);
        // console.log('Email:', data.current_user_email);
        // console.log('Message Count:', data.existing_message_count);
        // console.log('Context Set:', data.context_set);
        // console.log('Validation:', data.validation_result);
        // console.log('==================');

        return data;
    } catch (error) {
        console.error('Debug error:', error);
        return null;
    }
}

    // Rest of your existing methods remain the same...
    bindEvents() {
        this.chatButton.addEventListener('click', () => this.toggleChat());
        this.closeBtn.addEventListener('click', () => this.closeChat());
        this.sendBtn.addEventListener('click', () => this.sendMessage());
        this.messagePrompt.addEventListener('click', () => this.openChat());

        this.chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
                return;
            }

            if (e.key === ' ' || e.code === 'Space') {
                e.preventDefault();
                const start = this.chatInput.selectionStart;
                const end = this.chatInput.selectionEnd;
                const value = this.chatInput.value;
                this.chatInput.value = value.substring(0, start) + ' ' + value.substring(end);
                this.chatInput.selectionStart = this.chatInput.selectionEnd = start + 1;
                this.updateSendButton();
                return;
            }

            setTimeout(() => {
                this.chatInput.style.height = 'auto';
                this.chatInput.style.height = Math.min(this.chatInput.scrollHeight, 100) + 'px';
            }, 0);
        });

        this.chatInput.addEventListener('input', () => {
            this.updateSendButton();
        });

        document.addEventListener('click', (e) => {
            if (this.isOpen && !this.chatWindow.contains(e.target) && !this.chatButton.contains(e.target)) {
                this.closeChat();
            }
        });
    }

    addSpacebarFixToInput(input) {
        if (input) {
            input.addEventListener('keydown', (e) => {
                if (e.key === ' ' || e.code === 'Space') {
                    e.preventDefault();
                    const start = input.selectionStart;
                    const end = input.selectionEnd;
                    const value = input.value;
                    input.value = value.substring(0, start) + ' ' + value.substring(end);
                    input.selectionStart = input.selectionEnd = start + 1;
                }
            });
        }
    }

    setupFormHandlers() {
    if (this.chatForm) {
        this.chatForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleFormSubmission();
        });
    }
}


    updateSendButton() {
        const hasText = this.chatInput.value.trim().length > 0;
        this.sendBtn.disabled = !hasText || this.isSending;
    }

    toggleChat() {
        if (this.isOpen) {
            this.closeChat();
        } else {
            this.openChat();
        }
    }

    openChat() {
    const contactId = localStorage.getItem('ghl_contact_id');
    const userName = localStorage.getItem('user_name');
    const sessionActive = sessionStorage.getItem('chat_session_active');
    const emailVerified = localStorage.getItem('email_verified');
    const verificationTimestamp = localStorage.getItem('verification_timestamp');

      // Reset first load flag for sound every time chat opens
        this.isFirstLoad = true;


    // Check if verification is recent (within 24 hours)
    const verificationAge = verificationTimestamp ? Date.now() - parseInt(verificationTimestamp) : Infinity;
    const maxAge = 12 * 60 * 60 * 1000; // 24 hours

    if (contactId && emailVerified && verificationAge < maxAge && sessionActive) {
        this.openChatDirectly();
    } else if (contactId && emailVerified && verificationAge < maxAge && !sessionActive) {
        this.showQuickVerification(userName);
    } else {
        // Require verification
        this.showFullForm();
    }
}
    async openChatDirectly() {
        this.isOpen = true;
        this.chatWindow.classList.add('active');
        this.messagePrompt.classList.add('hidden');
        // PROPERLY hide the form overlay
        if (this.formOverlay) {
            this.formOverlay.classList.add('hidden');
            this.formOverlay.style.display = 'none';
        }

        // Reset first load flag for sound when opening directly
        this.isFirstLoad = true;

        sessionStorage.setItem('chat_session_active', 'true');

        // Only start new session if no session exists (i.e., after inactivity timeout)
        if (!this.sessionActive || !this.currentSessionId) {
            // Check if there's a session in sessionStorage that we can resume
            const existingSessionId = sessionStorage.getItem('current_session_id');
            const sessionActiveFlag = sessionStorage.getItem('session_active');

            if (existingSessionId && sessionActiveFlag === 'true') {
                // Resume existing session
                this.currentSessionId = existingSessionId;
                this.sessionStartTime = sessionStorage.getItem('session_start_time');
                this.sessionActive = true;
                // console.log('Resumed existing session:', this.currentSessionId);

                // Reset inactivity timer for resumed session
                this.resetInactivityTimer();
            } else {
                // No active session found, start new one
                this.startNewSession();
                console.log('Started new session - no previous session found');
            }
        } else {
            // Session is already active, just reset the inactivity timer
            // console.log('Continuing current session:', this.currentSessionId);
            this.resetInactivityTimer();
        }

        const userName = localStorage.getItem('user_name') || 'there';
        this.clearMessagesDisplay();

        setTimeout(async () => {
            await this.loadChatHistory();

            if (this.messages.length === 0) {
                await this.addMessage(`Welcome back, ${userName}! 👋 Great to see you again. How can I help you today?`, 'bot');
            }
        }, 100);

        // ADD THIS LINE at the end, before this.chatInput.focus();
        this.startIncomingMessagePolling();

        this.chatInput.focus();
    }

    showFullForm() {
        this.isOpen = true;
        this.chatWindow.classList.add('active');
        this.messagePrompt.classList.add('hidden');
        this.formOverlay.classList.remove('hidden');

        if (this.chatForm) {
            this.chatForm.style.display = 'flex';
        }
        if (this.formLoading) {
            this.formLoading.style.display = 'none';
        }

        setTimeout(() => {
            const nameInput = document.getElementById('userName');
            const emailInput = document.getElementById('userEmail');
            const phoneInput = document.getElementById('userPhone');

            this.addSpacebarFixToInput(nameInput);
            this.addSpacebarFixToInput(emailInput);
            this.addSpacebarFixToInput(phoneInput);

            if (nameInput) {
                nameInput.focus();
            }
        }, 100);
    }

    showQuickVerification(userName) {
        this.isOpen = true;
        this.chatWindow.classList.add('active');
        this.messagePrompt.classList.add('hidden');
        this.formOverlay.classList.remove('hidden');

        this.showQuickVerificationForm(userName);
    }

  showQuickVerificationForm(userName) {
    const formContainer = this.formOverlay.querySelector('.form-container');
    if (!formContainer) return;

    formContainer.innerHTML = `
        <div class="form-header">
            <h3>Welcome back! 👋</h3>
            <p>Continue as <strong>${userName}</strong>?</p>
        </div>

        <div class="verification-buttons">
            <button type="button" class="verify-yes-btn" id="verifyYesBtn">
                Yes, that's me
            </button>
            <button type="button" class="verify-no-btn" id="verifyNoBtn">
                No, I'm someone else
            </button>
        </div>
    `;

    this.addVerificationStyles();

    const verifyYesBtn = document.getElementById('verifyYesBtn');
    const verifyNoBtn = document.getElementById('verifyNoBtn');

    if (verifyYesBtn) {
        verifyYesBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.openChatDirectly();
        });
    }

    if (verifyNoBtn) {
        verifyNoBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.clearChatHistory();
            this.showFullFormFromVerification();
        });
    }
}

    showFullFormFromVerification() {
        const formContainer = this.formOverlay.querySelector('.form-container');
        if (!formContainer) return;

        formContainer.innerHTML = `
        <div class="form-logo-top">
            <img src="assets/OmniDent%20AI%20Logo.svg" alt="Company Logo" class="logo-image-top">
        </div>

        <div class="form-header">
            <h3>Let's get started!</h3>
            <p>Please provide your details to begin chatting</p>
        </div>

        <form class="chat-form" id="chatForm">
            <div class="form-row">
                <div class="form-group half-width">
                    <label for="userName">Full Name *</label>
                    <input type="text" id="userName" name="name" required placeholder="Enter your full name" oninvalid="this.setCustomValidity('Please enter your full name')" oninput="this.setCustomValidity('')">
                </div>
                <div class="form-group half-width">
                    <label for="userEmail">Email Address *</label>
                    <input type="email" id="userEmail" name="email" required placeholder="Enter your email" oninvalid="this.setCustomValidity('Please enter a valid email address')" oninput="this.setCustomValidity('')">
                </div>
            </div>

            <div class="form-row">
                <div class="form-group half-width">
                    <label for="userPhone">Phone Number *</label>
                    <input type="tel" id="userPhone" name="phone" placeholder="Enter your phone number" oninvalid="this.setCustomValidity('Please enter your phone number')" oninput="this.setCustomValidity('')">
                </div>
                <div class="form-group half-width">
                    <label for="userZipCode">Zip Code *</label>
                    <input type="text" id="userZipCode" name="zipCode" placeholder="Enter your zip code" maxlength="10" oninvalid="this.setCustomValidity('Please enter your zip code')" oninput="this.setCustomValidity('')">
                </div>
            </div>

            <div class="form-row">
                <div class="form-group half-width">
                    <label for="userGender">Identify as... *</label>
                    <select id="userGender" name="gender" oninvalid="this.setCustomValidity('Please select your gender')" onchange="this.setCustomValidity('')">
                        <option value="">Select gender</option>
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                        <option value="non-binary">Non-Binary</option>
                    </select>
                </div>

                <div class="form-group half-width">
                    <label for="userAge">Age *</label>
                    <input type="number" id="userAge" name="age" placeholder="Enter your age" min="1" max="120" oninvalid="this.setCustomValidity('Please enter your age')" oninput="this.setCustomValidity('')">
                </div>
            </div>

            <div class="consent-group">
                <label class="consent-checkbox">
                    <input type="checkbox" name="marketingConsent" required id="marketingConsent">
                    <span class="custom-checkbox"></span>
                    <span class="consent-text">I consent to receive appointment reminders and practice updates by text and email via OmniDent AI. My data is secured under HIPAA. Reply STOP to unsubscribe. *</span>
                </label>
                <div id="consentError" style="color: #ef4444; font-size: 12px; margin-top: 4px; display: none; padding-left: 36px;">You must consent to continue</div>
            </div>

            <button type="submit" class="form-submit-btn" id="formSubmitBtn">
                Start Chat
            </button>
        </form>

        <div class="form-loading" id="formLoading" style="display: none;">
            <div class="loading-spinner"></div>
            <p>Setting up your chat...</p>
        </div>
    `;

        this.chatForm = document.getElementById('chatForm');
        this.formLoading = document.getElementById('formLoading');
        this.formSubmitBtn = document.getElementById('formSubmitBtn');

        this.formOverlay.classList.remove('hidden');



        if (this.chatForm) {
            this.chatForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleFormSubmission();
            });
        }

        setTimeout(() => {
            const nameInput = document.getElementById('userName');
            const emailInput = document.getElementById('userEmail');
            const phoneInput = document.getElementById('userPhone');

            this.addSpacebarFixToInput(nameInput);
            this.addSpacebarFixToInput(emailInput);
            this.addSpacebarFixToInput(phoneInput);

            if (nameInput) {
                nameInput.focus();
            }
        }, 100);
    }

 // 10. Update your addVerificationStyles method to include success animation
addVerificationStyles() {
    if (document.querySelector('style[data-verification-form-styles]')) return;

    const style = document.createElement('style');
    style.setAttribute('data-verification-form-styles', 'true');
    style.textContent = `
        /* Your existing styles... */
        .verification-form {
            display: flex;
            flex-direction: column;
            gap: 20px;
            align-items: center;
            width: 100%;
        }

        .verification-form .form-group {
            width: 100%;
            max-width: 320px;
        }

        .verification-form input[type="text"] {
            width: 100%;
            max-width: 320px;
            text-align: center;
            font-size: 28px;
            font-weight: bold;
            letter-spacing: 12px;
            padding: 20px 25px;
            border: 2px solid #e2e8f0;
            border-radius: 12px;
            transition: all 0.2s ease;
            box-sizing: border-box;
            background: white;
            color: #112359;
        }

        .verification-form input[type="text"]:focus {
            border-color: #34d399;
            box-shadow: 0 0 0 3px rgba(52, 211, 153, 0.1);
            outline: none;
        }

        .verification-form input[type="text"]::placeholder {
            color: #d1d5db;
            font-weight: normal;
            letter-spacing: 8px;
        }

        .verification-note {
            font-size: 14px;
            color: #64748b;
            margin: 5px 0 0 0;
            text-align: center;
        }

        .form-secondary-btn {
            background: transparent;
            color: #64748b;
            border: 2px solid #e2e8f0;
            padding: 12px 20px;
            border-radius: 8px;
            font-size: 14px;
            cursor: pointer;
            transition: all 0.2s ease;
            width: 100%;
            max-width: 320px;
        }

        .form-secondary-btn:hover:not(:disabled) {
            border-color: #cbd5e1;
            color: #475569;
        }

        .form-secondary-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .verification-loading {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 15px;
            padding: 30px;
            text-align: center;
        }

        /* Add success animation */
        @keyframes successSlideIn {
            from {
                opacity: 0;
                transform: translateY(-10px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        @media (max-width: 480px) {
            .verification-form input[type="text"] {
                font-size: 24px;
                letter-spacing: 8px;
                padding: 16px 20px;
            }

            .verification-form .form-group,
            .form-secondary-btn {
                max-width: 100%;
            }

            .verification-form input[type="text"]::placeholder {
                letter-spacing: 6px;
            }
        }
    `;
    document.head.appendChild(style);
}

// Add this to your existing addVerificationStyles() method or create a new style method
addConsentStyles() {
    if (document.querySelector('style[data-consent-styles]')) return;

    const style = document.createElement('style');
    style.setAttribute('data-consent-styles', 'true');
    style.textContent = `
        .consent-group {
            margin: 16px 0;
        }

        .consent-checkbox {
            display: flex;
            align-items: flex-start;
            gap: 12px;
            cursor: pointer;
            line-height: 1.4;
        }

        .consent-checkbox input[type="checkbox"] {
            position: absolute;
            opacity: 0;
            cursor: pointer;
        }

        .checkmark {
            width: 20px;
            height: 20px;
            background-color: white;
            border: 2px solid #e2e8f0;
            border-radius: 4px;
            position: relative;
            flex-shrink: 0;
            margin-top: 2px;
            transition: all 0.2s ease;
        }

        .consent-checkbox:hover .checkmark {
            border-color: #34d399;
        }

        .consent-checkbox input:checked ~ .checkmark {
            background-color: #34d399;
            border-color: #34d399;
        }

        .consent-checkbox input:checked ~ .checkmark:after {
            content: "";
            position: absolute;
            display: block;
            left: 6px;
            top: 2px;
            width: 6px;
            height: 10px;
            border: solid white;
            border-width: 0 2px 2px 0;
            transform: rotate(45deg);
        }

        .consent-text {
            font-size: 13px;
            color: #64748b;
            line-height: 1.4;
        }

        .consent-checkbox input:required:invalid ~ .checkmark {
            border-color: #ef4444;
        }
    `;
    document.head.appendChild(style);
}
    // Simplified validation - let N8N handle the heavy lifting, then validate with Supabase

// Enhanced handleFormSubmission with detailed debugging
async handleFormSubmission() {
    const formData = new FormData(this.chatForm);
    const userData = {
        name: formData.get('name'),
        email: formData.get('email'),
        phone: formData.get('phone') || '',
        zipCode: formData.get('zipCode') || '',
        gender: formData.get('gender') || '',
        age: formData.get('age') || '',
        marketingConsent: formData.get('marketingConsent') === 'on'
    };

    // Check consent
    const consentCheckbox = document.querySelector('input[name="marketingConsent"]');
    if (consentCheckbox && !consentCheckbox.checked) {
        this.showFormError('You must consent to continue', 'consent_required');
        return;
    }

    try {
        // Submit to N8N for verification
        const response = await this.submitFormToN8n(userData);

        if (!response.success) {
            this.showFormError(response.message || 'Email not found in our system.');
            return;
        }

        // Store temporarily for verification process
        sessionStorage.setItem('temp_user_data', JSON.stringify(userData));

        if (response.verification_sent) {
            this.showVerificationForm(userData.email, userData.name, userData.phone);
        } else {
            this.showFormError('Unexpected response format.');
        }

    } catch (error) {
        console.error('Form submission error:', error);
        this.showFormError('Network error. Please try again.');
    }
}

// Send verification code
async sendVerificationCode(email, name, phone) {
    try {
        // Use existing form-submit workflow
        const response = await this.submitFormToN8n({
            name: name,
            email: email,
            phone: phone
        });

        if (!response.success || !response.verification_sent) {
            this.showFormError(response.message || 'Failed to send verification code.');
            return;
        }

        // Show verification form
        this.showVerificationForm(email, name, phone);

    } catch (error) {
        console.error('Error sending verification code:', error);
        this.showFormError('Failed to send verification code. Please try again.');
    }
}

// Show verification code form
showVerificationForm(email, name, phone, zipCode) {
        // Store zip code for later use
    this.tempZipCode = zipCode;
    this.tempMarketingConsent = this.getMarketingConsent(); // Add this line
    const formContainer = this.formOverlay.querySelector('.form-container');
    if (!formContainer) return;

    formContainer.innerHTML = `
        <div class="form-header">
            <h3>Check Your Email 📧</h3>
            <p>We sent a 6-digit code to <strong>${email}</strong></p>
            <p class="verification-note">Enter the code to continue</p>
        </div>

        <form class="verification-form" id="verificationForm">
            <div class="form-group">
                <label for="verificationCode">Verification Code</label>
                <input
                    type="text"
                    id="verificationCode"
                    name="code"
                    required
                    placeholder="000000"
                    maxlength="6"
                    pattern="[0-9]{6}"
                    autocomplete="one-time-code"
                    >
            </div>

            <button type="submit" class="form-submit-btn" id="verifyCodeBtn">
                Verify Code
            </button>

            <button type="button" class="form-secondary-btn" id="resendCodeBtn">
                Resend Code
            </button>
        </form>

        <div class="verification-loading" id="verificationLoading" style="display: none;">
            <div class="loading-spinner"></div>
            <p>Verifying code...</p>
        </div>
    `;

    this.addVerificationStyles();
    this.setupVerificationHandlers(email, name, phone);
}
// Setup verification form handlers
// 2. Update your setupVerificationHandlers method
setupVerificationHandlers(email, name, phone) {
    const verificationForm = document.getElementById('verificationForm');
    const resendBtn = document.getElementById('resendCodeBtn');
    const codeInput = document.getElementById('verificationCode');

    // Auto-format code input
    if (codeInput) {
        codeInput.addEventListener('input', (e) => {
            // Only allow numbers
            e.target.value = e.target.value.replace(/[^0-9]/g, '');

            // Auto-submit when 6 digits entered
            if (e.target.value.length === 6) {
                setTimeout(() => {
                    if (verificationForm) {
                        verificationForm.dispatchEvent(new Event('submit'));
                    }
                }, 100);
            }
        });

        codeInput.focus();
    }

    // Handle form submission
    if (verificationForm) {
        verificationForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.verifyCode(email, codeInput.value.trim(), name);
        });
    }

    // Handle resend with timer - UPDATED
    if (resendBtn) {
        resendBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            if (!this.resendCooldown) {
                await this.handleResendCode(email, name, phone, this.tempZipCode);
            }
        });
    }
}

// 3. Add this new method for handling resend with timer
async handleResendCode(email, name, phone) {
    const resendBtn = document.getElementById('resendCodeBtn');
    if (!resendBtn) return;

    try {
        // Start cooldown immediately
        this.startResendCooldown();

        // Send verification code
        const response = await this.submitFormToN8n({
            name: name,
            email: email,
            phone: phone,
            // zipCode: zipCode || '', // Include zip code
            // marketingConsent: this.tempMarketingConsent || false // Add this line
        });

        if (!response.success || !response.verification_sent) {
            this.showVerificationError(response.message || 'Failed to send verification code.');
            this.stopResendCooldown(); // Stop cooldown on error
            return;
        }

        // Show success message briefly
        this.showResendSuccess();

    } catch (error) {
        console.error('Error sending verification code:', error);
        this.showVerificationError('Failed to send verification code. Please try again.');
        this.stopResendCooldown(); // Stop cooldown on error
    }
}

// 4. Add method to start the cooldown timer
startResendCooldown() {
    const resendBtn = document.getElementById('resendCodeBtn');
    if (!resendBtn) return;

    this.resendCooldown = true;
    this.resendCountdown = 60;

    // Create timer display element
    this.createTimerDisplay();

    // Disable button
    resendBtn.disabled = true;
    resendBtn.style.opacity = '0.5';
    resendBtn.style.cursor = 'not-allowed';

    // Start countdown
    this.resendTimer = setInterval(() => {
        this.resendCountdown--;
        this.updateTimerDisplay();

        if (this.resendCountdown <= 0) {
            this.stopResendCooldown();
        }
    }, 1000);

    // Update button text immediately
    this.updateTimerDisplay();
}

// 5. Add method to stop the cooldown
stopResendCooldown() {
    const resendBtn = document.getElementById('resendCodeBtn');

    this.resendCooldown = false;

    if (this.resendTimer) {
        clearInterval(this.resendTimer);
        this.resendTimer = null;
    }

    // Re-enable button
    if (resendBtn) {
        resendBtn.disabled = false;
        resendBtn.style.opacity = '1';
        resendBtn.style.cursor = 'pointer';
        resendBtn.textContent = 'Resend Code';
    }

    // Remove timer display
    this.removeTimerDisplay();
}

// 6. Add method to create timer display
createTimerDisplay() {
    // Remove existing timer if any
    this.removeTimerDisplay();

    const resendBtn = document.getElementById('resendCodeBtn');
    if (!resendBtn) return;

    const timerDiv = document.createElement('div');
    timerDiv.id = 'resendTimer';
    timerDiv.style.cssText = `
        font-size: 12px;
        color: #64748b;
        text-align: center;
        margin-top: 8px;
        font-weight: 500;
    `;

    // Insert after the resend button
    resendBtn.parentNode.insertBefore(timerDiv, resendBtn.nextSibling);
}

// 7. Add method to update timer display
updateTimerDisplay() {
    const resendBtn = document.getElementById('resendCodeBtn');
    const timerDiv = document.getElementById('resendTimer');

    if (resendBtn) {
        resendBtn.textContent = `Resend Code (${this.resendCountdown}s)`;
    }

    if (timerDiv) {
        timerDiv.textContent = `You can request a new code in ${this.resendCountdown} seconds`;
    }
}

// 8. Add method to remove timer display
removeTimerDisplay() {
    const timerDiv = document.getElementById('resendTimer');
    if (timerDiv) {
        timerDiv.remove();
    }
}

// 9. Add method to show resend success message
showResendSuccess() {
    // Remove any existing success messages
    const existingSuccess = document.querySelector('.resend-success-message');
    if (existingSuccess) {
        existingSuccess.remove();
    }

    const successDiv = document.createElement('div');
    successDiv.className = 'resend-success-message';
    successDiv.innerHTML = `
        <div class="success-icon">✅</div>
        <div class="success-text">New verification code sent!</div>
    `;

    // Add success styles
    successDiv.style.cssText = `
        display: flex;
        align-items: center;
        gap: 10px;
        background: #f0fdf4;
        border: 1px solid #bbf7d0;
        border-radius: 8px;
        padding: 12px 16px;
        margin: 0 auto 20px auto;
        width: 100%;
        max-width: 320px;
        box-sizing: border-box;
        color: #166534;
        font-size: 14px;
        font-weight: 500;
        animation: successSlideIn 0.3s ease-out;
    `;

    // Find the form container and insert before verification form
    const formContainer = this.formOverlay.querySelector('.form-container');
    const verificationForm = document.getElementById('verificationForm');

    if (formContainer && verificationForm) {
        formContainer.insertBefore(successDiv, verificationForm);
    }

    // Auto-remove success message after 3 seconds
    setTimeout(() => {
        if (successDiv.parentNode) {
            successDiv.remove();
        }
    }, 3000);
}


// Verify the entered code
async verifyCode(email, enteredCode, name) {
    const verificationForm = document.getElementById('verificationForm');
    const verificationLoading = document.getElementById('verificationLoading');

    if (enteredCode.length !== 6) {
        this.showVerificationError('Please enter a 6-digit code.');
        return;
    }

    // Show loading
    if (verificationForm) verificationForm.style.display = 'none';
    if (verificationLoading) verificationLoading.style.display = 'flex';

    try {
        const response = await fetch(this.codeVerificationUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: email,
                code: enteredCode
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error: ${response.status}`);
        }

        const data = await response.json();

        if (!data.success) {
            // Hide loading first
            if (verificationLoading) verificationLoading.style.display = 'none';
            if (verificationForm) verificationForm.style.display = 'flex';

            // Show error message
            this.showVerificationError(data.message || 'Invalid verification code. Please try again.');

            // Clear and focus input
            const codeInput = document.getElementById('verificationCode');
            if (codeInput) {
                codeInput.value = '';
                codeInput.focus();
            }
            return;
        }

        // Verification successful - store data and proceed
        localStorage.setItem('ghl_contact_id', data.contact_id);
        localStorage.setItem('user_name', data.user_name);
        localStorage.setItem('user_email', email);
        localStorage.setItem('email_verified', 'true');
        localStorage.setItem('verification_timestamp', Date.now().toString());

        // Save user profile to Supabase (for new users or profile updates)
        const tempUserData = sessionStorage.getItem('temp_user_data');
        if (tempUserData) {
            try {
                const userData = JSON.parse(tempUserData);
                const profileSaved = await this.saveUserProfile(userData);
                if (profileSaved) {
                    // console.log('User profile saved to Supabase');
                } else {
                    console.warn('Failed to save user profile to Supabase');
                }
                // Clean up temporary data
                sessionStorage.removeItem('temp_user_data');
            } catch (profileError) {
                console.error('Error saving user profile:', profileError);
                // Don't block the user flow if profile save fails
            }
        }

        // Set user context
        const authenticated = await this.setUserContext(data.contact_id);
        if (!authenticated) {
            this.showVerificationError('Authentication failed. Please try again.');
            return;
        }

        // Open chat
        const isExistingUser = !data.is_new;

        if (isExistingUser) {
            await this.openChatAfterForm(data.user_name, true);
        } else {
            this.clearChatHistory();
            await this.openChatAfterForm(data.user_name, false);
        }

    } catch (error) {
        console.error('Verification error:', error);
        this.showVerificationError('Verification failed. Please try again.');
        if (verificationForm) verificationForm.style.display = 'flex';
        if (verificationLoading) verificationLoading.style.display = 'none';
    }
}

// New method specifically for verification errors
showVerificationError(message) {
    // Remove any existing error messages
    const existingError = document.querySelector('.form-error-message');
    if (existingError) {
        existingError.remove();
    }

    const errorDiv = document.createElement('div');
    errorDiv.className = 'form-error-message';
    errorDiv.innerHTML = `
        <div class="error-icon">⚠️</div>
        <div class="error-text">${message}</div>
    `;

    // Add error styles if not already present
    this.addErrorStyles();

    // Find the form container and insert error before the verification form
    const formContainer = this.formOverlay.querySelector('.form-container');
    const verificationForm = document.getElementById('verificationForm');

    if (formContainer && verificationForm) {
        formContainer.insertBefore(errorDiv, verificationForm);
    }

    // Auto-remove error after 8 seconds
    setTimeout(() => {
        if (errorDiv.parentNode) {
            errorDiv.remove();
        }
    }, 8000);
}

// Add the missing testDatabaseAccess method (optional, for debugging)
async testDatabaseAccess() {
    if (!this.isSupabaseEnabled) return true;

    try {
        console.log('Testing database access...');

        // Simple test - try to read messages
        const { data, error, count } = await this.supabase
            .from('chat_messages')
            .select('id', { count: 'exact' })
            .limit(1);

        if (error) {
            console.warn('Database access test failed:', error);
            return false;
        }

        console.log(`Database access test passed. Total messages: ${count}`);
        return true;
    } catch (error) {
        console.warn('Database access test error:', error);
        return false;
    }
}

// Add method to check what N8N is actually returning
async debugN8nResponse(userData) {
    console.log('=== N8N DEBUG ===');
    console.log('Submitting to N8N:', userData);

    try {
        const response = await this.submitFormToN8n(userData);
        console.log('Raw N8N response:', response);

        // Parse the response to understand its structure
        if (response.success) {
            console.log('✅ N8N Success Response:');
            console.log('  - Contact ID:', response.contact_id);
            console.log('  - User Name:', response.user_name);
            console.log('  - Status:', response.status);
            console.log('  - User Data:', response.user_data);
        } else {
            console.log('❌ N8N Error Response:');
            console.log('  - Message:', response.message);
            console.log('  - Error Type:', response.error_type);
        }

        return response;
    } catch (error) {
        console.error('N8N submission error:', error);
        return null;
    }
}

// New validation method that checks contact_id + email combination
async validateContactEmailCombo(contactId, email) {
    if (!this.isSupabaseEnabled) {
        return { valid: true, has_previous_messages: false, message: 'Supabase not enabled' };
    }

    try {
        console.log('Validating contact+email combo:', contactId, email);

        // Use the validation function
        const { data: isValid, error } = await this.supabase.rpc('validate_user_access', {
            check_contact_id: contactId,
            check_email: email
        });

        if (error) {
            console.warn('Validation error:', error);
            return { valid: false, message: 'Validation failed' };
        }

        if (!isValid) {
            return { valid: false, message: 'Access denied - email mismatch' };
        }

        // Check if user has existing messages
        const { data: existingMessages, error: msgError } = await this.supabase
            .from('chat_messages')
            .select('id')
            .eq('contact_id', contactId)
            .limit(1);

        const hasPreviousMessages = !msgError && existingMessages && existingMessages.length > 0;

        return {
            valid: true,
            has_previous_messages: hasPreviousMessages,
            message: 'Access granted'
        };

    } catch (error) {
        console.warn('Validation error:', error);
        return { valid: false, message: 'Validation error' };
    }
}
// Enhanced debugging
async debugContactEmailValidation() {
    const contactId = localStorage.getItem('ghl_contact_id');
    const email = localStorage.getItem('user_email');

    console.log('=== CONTACT/EMAIL VALIDATION DEBUG ===');
    console.log('Contact ID:', contactId);
    console.log('Email:', email);

    if (!contactId || !email) {
        console.log('Missing data for validation');
        return;
    }

    if (!this.isSupabaseEnabled) {
        console.log('Supabase not enabled');
        return;
    }

    try {
        // Test the validation function
        const validation = await this.validateContactEmailCombo(contactId, email);
        console.log('Validation Result:', validation);

        // Check what messages exist for this contact
        const { data: allMessages, error } = await this.supabase
            .from('chat_messages')
            .select('contact_id, user_email, created_at')
            .eq('contact_id', contactId);

        if (!error && allMessages) {
            console.log('All messages for this contact_id:', allMessages);
        }

        // Test RLS context
        await this.debugRLSContext();

    } catch (error) {
        console.error('Debug error:', error);
    }

    console.log('=== END VALIDATION DEBUG ===');
}


    showFormError(message, errorType = null) {
        if (this.formLoading) {
            this.formLoading.style.display = 'none';
        }
        if (this.chatForm) {
            this.chatForm.style.display = 'flex';
        }

        const existingError = document.querySelector('.form-error-message');
        if (existingError) {
            existingError.remove();
        }

        const errorDiv = document.createElement('div');
        errorDiv.className = 'form-error-message';
        errorDiv.innerHTML = `
            <div class="error-icon">⚠️</div>
            <div class="error-text">${message}</div>
        `;

        this.addErrorStyles();

        const formContainer = this.formOverlay.querySelector('.form-container');
        const formElement = formContainer ? formContainer.querySelector('.chat-form') : null;

        if (formContainer && formElement) {
            formContainer.insertBefore(errorDiv, formElement);
        }

        if (errorType === 'duplicate_email' || errorType === 'invalid_email') {
            const emailInput = document.getElementById('userEmail');
            if (emailInput) {
                emailInput.style.borderColor = '#ef4444';
                emailInput.focus();
            }
        } else if (errorType === 'invalid_phone') {
            const phoneInput = document.getElementById('userPhone');
            if (phoneInput) {
                phoneInput.style.borderColor = '#ef4444';
                phoneInput.focus();
            }
        }

        setTimeout(() => {
            if (errorDiv.parentNode) {
                errorDiv.remove();
            }
            const emailInput = document.getElementById('userEmail');
            const phoneInput = document.getElementById('userPhone');
            if (emailInput) emailInput.style.borderColor = '';
            if (phoneInput) phoneInput.style.borderColor = '';
        }, 8000);
    }

    addErrorStyles() {
        if (document.querySelector('style[data-error-styles]')) return;

        const style = document.createElement('style');
        style.setAttribute('data-error-styles', 'true');
        style.textContent = `
            .form-error-message {
                display: flex;
                align-items: center;
                gap: 10px;
                background: #fef2f2;
                border: 1px solid #fecaca;
                border-radius: 8px;
                padding: 12px 16px;
                margin-bottom: 20px;
                animation: errorSlideIn 0.3s ease-out;
            }

            .error-icon {
                font-size: 18px;
                flex-shrink: 0;
            }

            .error-text {
                color: #dc2626;
                font-size: 14px;
                font-weight: 500;
                line-height: 1.4;
            }

            @keyframes errorSlideIn {
                from {
                    opacity: 0;
                    transform: translateY(-10px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }
        `;
        document.head.appendChild(style);
    }

    async submitFormToN8n(userData) {
    const tempSessionId = sessionStorage.getItem('chat-session-id');

    const payload = {
        name: userData.name,
        email: userData.email,
        phone: userData.phone,
        zipCode: userData.zipCode || '', // Add zip code
        gender: userData.gender,
        age: userData.age,
        marketingConsent: userData.marketingConsent || false, // Add consent
        source: 'chat_widget',
        temp_session_id: tempSessionId,
        timestamp: new Date().toISOString()
    };

    const response = await fetch(this.formWebhookUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
    }

    const data = await response.json();

    // REMOVE THIS CHECK - no longer needed for verification flow
    // if (!data.contact_id) {
    //     throw new Error('No contact_id received from server');
    // }

    // Update session storage if contact_id exists (for verification response)
    if (data.contact_id) {
        sessionStorage.setItem('chat-session-id', data.contact_id);
    }

    return data;
}

    async openChatAfterForm(userName, isExistingUser = false) {
    this.formOverlay.classList.add('hidden');
    sessionStorage.setItem('chat_session_active', 'true');

     // First approach: Use the class instance reference
    if (this.formOverlay) {
        this.formOverlay.classList.add('hidden');
        this.formOverlay.style.display = 'none';
    }

    // Second approach (fallback): Use the ID directly
    const overlayById = document.getElementById('chatFormOverlay');
    if (overlayById) {
        overlayById.classList.add('hidden');
        overlayById.style.display = 'none';
    }


    // Start new session
    this.startNewSession();

    // Clear messages display
    this.clearMessagesDisplay();

    // Set user context and verify it's working
    const contactId = localStorage.getItem('ghl_contact_id');
    const email = localStorage.getItem('user_email');

    const contextResult = await this.setUserContext(contactId);
    if (!contextResult) {
        this.showVerificationError('Authentication failed. Please try again.');
        return;
    }

    if (isExistingUser) {
        // For existing users - load chat history
        await this.loadChatHistory();

        if (this.messages.length === 0) {
            await this.addMessage(`Welcome back, ${userName}! 👋 Great to see you again. How can I help you today?`, 'bot');
        }
    } else {
        // For new users - don't load history, just show welcome message
        await this.addMessage(`Hi ${userName}! 👋 Thanks for providing your details. How can I help you today?`, 'bot');
    }

    this.chatInput.focus();
}

// Test function to manually test context setting
async testContextSetting() {
    const contactId = localStorage.getItem('ghl_contact_id');
    const email = localStorage.getItem('user_email');

    console.log('=== CONTEXT SETTING TEST ===');
    console.log('Testing with:', contactId, email);

    if (!contactId || !email) {
        console.log('Missing credentials');
        return;
    }

    try {
        // Test setting context
        const result = await this.setUserContext(contactId);
        console.log('Context set result:', result);

        // Test debugging
        const debug = await this.debugRLSContext();
        console.log('Debug result:', debug);

        // Test validation directly
        const { data: validation, error } = await this.supabase.rpc('validate_user_access', {
            check_contact_id: contactId,
            check_email: email
        });
        console.log('Direct validation:', validation, 'error:', error);

    } catch (error) {
        console.error('Test error:', error);
    }

    console.log('=== END CONTEXT TEST ===');
}



    areMessagesExpired(timestamp) {
        if (!timestamp) return true;

        const messageDate = new Date(timestamp);
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() - this.messageExpiryDays);

        return messageDate < expiryDate;
    }

    clearChatHistory() {
        const contactId = localStorage.getItem('ghl_contact_id');
        if (contactId) {
            const storageKey = `chat_messages_${contactId}`;
            localStorage.removeItem(storageKey);
        }
        this.messages = [];
        this.messagesOffset = 0;
        this.hasMoreMessages = true;
        this.clearMessagesDisplay();
        // ADD THIS LINE to stop polling when clearing history
        this.stopIncomingMessagePolling();
    }

    clearMessagesDisplay() {
        if (this.chatMessages) {
            // Keep the load more button but hide it
            if (this.loadMoreContainer) {
                this.loadMoreContainer.style.display = 'none';
            }

            // Clear all messages except the load more container
            const children = Array.from(this.chatMessages.children);
            children.forEach(child => {
                if (child !== this.loadMoreContainer) {
                    child.remove();
                }
            });
        }
    }

    cleanupOldChatHistory() {
        const keysToRemove = [];

        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('chat_messages_')) {
                try {
                    const data = JSON.parse(localStorage.getItem(key));
                    if (this.areMessagesExpired(data.timestamp)) {
                        keysToRemove.push(key);
                    }
                } catch (error) {
                    keysToRemove.push(key);
                }
            }
        }

        keysToRemove.forEach(key => localStorage.removeItem(key));
    }

    clearMessages() {
        this.clearMessagesDisplay();
        this.messages = [];
    }

    async closeChat() {
        this.isOpen = false;
        this.chatWindow.classList.remove('active');

        // DON'T end session when chat is closed - only on inactivity timeout
        // The session should continue running in the background
        // Users can reopen and continue the same conversation

        const contactId = localStorage.getItem('ghl_contact_id');
        if (!contactId) {
            setTimeout(() => {
                this.messagePrompt.classList.remove('hidden');
            }, 500);
        }
    }



    async sendMessage() {
    const message = this.chatInput.value.trim();
    if (!message || this.isSending) return;

    // Check if session is active, if not - restart automatically
    if (!this.sessionActive) {
        // Remove any existing session timeout messages
        const systemMessages = document.querySelectorAll('.message.system');
        systemMessages.forEach(msg => msg.remove());

        // Start new session automatically
        this.startNewSession();

        // Add a quick "restarted" message
        await this.addSystemMessage('🔄 New conversation started');
    }

    this.isSending = true;
    this.updateSendButton();

    // Clear input IMMEDIATELY to fix delay
    const messageToSend = message;
    this.chatInput.value = '';
    this.chatInput.style.height = 'auto'; // Reset height for textarea

    await this.addMessage(messageToSend, 'user');

    this.showTypingIndicator();

    try {
        const response = await this.fetchBotResponse(messageToSend);
        this.hideTypingIndicator();

        if (Array.isArray(response)) {
            await this.showMessagesSequentially(response);
        } else {
            await this.addMessage(response, 'bot');
        }
    } catch (error) {
        this.hideTypingIndicator();
        await this.addMessage("I'm sorry, I'm having trouble responding right now. Please try again later.", 'bot');
    } finally {
        this.isSending = false;
        this.updateSendButton();
    }
}

    // 6. Update showMessagesSequentially to play sounds for bot responses
    async showMessagesSequentially(messages) {
    for (let i = 0; i < messages.length; i++) {
        if (i > 0) {
            this.showTypingIndicator();
            await new Promise(resolve => setTimeout(resolve, 800));
            this.hideTypingIndicator();
        }

        await this.addMessage(messages[i], 'bot');
        // Small delay between multiple bot messages
        if (i < messages.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 300));
        }
    }
}

    async fetchBotResponse(userMessage) {
    const contactId = localStorage.getItem('ghl_contact_id');
    const sessionId = this.getCurrentSessionId();
    const userName = localStorage.getItem('user_name') || 'Chat Visitor';
    const userEmail = localStorage.getItem('user_email') || `${sessionId}@example.com`;

    // Load user profile from Supabase
    const userProfile = await this.loadUserProfile();

    const payload = {
        message: userMessage,
        contact_id: contactId,
        session_id: sessionId,
        name: userName,
        email: userEmail,
        phone: userProfile?.phone || '',
        zipCode: userProfile?.zip_code || '',
        gender: userProfile?.gender || '',
        age: userProfile?.age || '',
        marketingConsent: userProfile?.marketing_consent || false,
        channel: 'webchat',
        timestamp: new Date().toISOString()
    };


        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 120000);

        const response = await fetch(this.webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`HTTP error: ${response.status}`);
        }

        const data = await response.json();
        return this.parseN8nMessages(data);
    }

    parseN8nMessages(data) {
        try {
            let responseData = data;

            if (Array.isArray(data) && data.length > 0) {
                responseData = data[0];
            }

            if (responseData.data && responseData.data.split_json) {
                responseData = responseData.data;
            }

            const splitJson = responseData.split_json;
            if (!splitJson) {
                return "Thank you for your message!";
            }

            let messageData;
            if (typeof splitJson === 'string') {
                messageData = JSON.parse(splitJson);
            } else {
                messageData = splitJson;
            }

            if (messageData.content) {
                messageData = messageData.content;
            }

            const messages = [];
            const messageKeys = Object.keys(messageData)
                .filter(key => key.startsWith('message'))
                .sort();

            messageKeys.forEach(key => {
                const content = messageData[key];
                if (content && content.trim() !== '') {
                    messages.push(content.trim());
                }
            });

            if (messages.length > 0) {
                return messages;
            }

            return "Thank you for your message!";

        } catch (error) {
            return "Thank you for your message!";
        }
    }

    getSessionId() {
        const contactId = localStorage.getItem('ghl_contact_id');
        if (contactId) {
            sessionStorage.setItem('chat-session-id', contactId);
            return contactId;
        }

        let sessionId = sessionStorage.getItem('chat-session-id');
        if (!sessionId) {
            sessionId = 'temp-session-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
            sessionStorage.setItem('chat-session-id', sessionId);
        }
        return sessionId;
    }

    formatTimestamp(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diffInMinutes = Math.floor((now - date) / 60000);

        if (diffInMinutes < 1) {
            return 'Just now';
        } else if (diffInMinutes < 60) {
            return `${diffInMinutes}m ago`;
        } else if (diffInMinutes < 1440) {
            const hours = Math.floor(diffInMinutes / 60);
            return `${hours}h ago`;
        } else {
            return date.toLocaleDateString();
        }
    }

    addMessageToDOM(content, sender, timestamp = null, prepend = false) {
        if (!this.chatMessages) return;

        const messageEl = document.createElement('div');
        messageEl.className = `message ${sender}`;

        const displayTime = timestamp || new Date().toISOString();
        const timeStr = this.formatTimestamp(displayTime);

        // Parse markdown for hyperlinks
        const processedContent = this.parseMarkdownLinks(content);

        if (sender === 'bot') {
            messageEl.innerHTML = `
                <div class="bot-avatar">
                    <svg viewBox="0 0 256 256">
                        <path d="M224.32,114.24a56,56,0,0,0-60.07-76.57A56,56,0,0,0,67.93,51.44a56,56,0,0,0-36.25,90.32A56,56,0,0,0,69,217A56.39,56.39,0,0,0,83.59,219a55.75,55.75,0,0,0,8.17-.61a56,56,0,0,0,96.31-13.78,56,56,0,0,0,36.25-90.32ZM182.85,54.43a40,40,0,0,1,28.56,48c-.95-.63-1.91-1.24-2.91-1.81L164,74.88a8,8,0,0,0-8,0l-44,25.41V81.81l40.5-23.38A39.76,39.76,0,0,1,182.85,54.43ZM144,137.24l-16,9.24-16-9.24V118.76l16-9.24,16,9.24ZM80,72a40,40,0,0,1,67.53-29c-1,.51-2,1-3,1.62L100,70.27a8,8,0,0,0-4,6.92V128l-16-9.24ZM40.86,86.93A39.75,39.75,0,0,1,64.12,68.57C64.05,69.71,64,70.85,64,72v51.38a8,8,0,0,0,4,6.93l44,25.4L96,165,55.5,141.57A40,40,0,0,1,40.86,86.93ZM73.15,201.57a40,40,0,0,1-28.56-48c.95.63,1.91,1.24,2.91,1.81L92,181.12a8,8,0,0,0,8,0l44-25.41v18.48l-40.5,23.38A39.76,39.76,0,0,1,73.15,201.57ZM176,184a40,40,0,0,1-67.52,29.05c1-.51,2-1.05,3-1.63L156,185.73a8,8,0,0,0,4-6.92V128l16,9.24Zm39.14-14.93a39.75,39.75,0,0,1-23.26,18.36c.07-1.14.12-2.28.12-3.43V132.62a8,8,0,0,0-4-6.93l-44-25.4,16-9.24,40.5,23.38A40,40,0,0,1,215.14,169.07Z"/>
                    </svg>
                </div>
                <div class="message-content">
                    ${processedContent}
                    <div class="message-timestamp">${timeStr}</div>
                </div>
            `;
        } else {
            messageEl.innerHTML = `
                <div class="message-content">
                    ${processedContent}
                    <div class="message-timestamp">${timeStr}</div>
                </div>
            `;
        }

         if (prepend) {
        // Historical messages - NO SOUND
        const firstMessage = this.chatMessages.querySelector('.message');
        if (firstMessage) {
            this.chatMessages.insertBefore(messageEl, firstMessage);
        } else {
            this.chatMessages.appendChild(messageEl);
        }
    } else {
        // New messages - PLAY SOUND
        this.chatMessages.appendChild(messageEl);
        this.scrollToBottom();

        // Only play sound for NEW bot messages (not historical ones)
        if (sender === 'bot') {
            this.playSound('receive');
        }
    }
}

   addSystemMessageToDOM(content, timestamp, showNewSessionButton = false) {
    if (!this.chatMessages) return;

    const messageEl = document.createElement('div');
    messageEl.className = 'message system session-timeout-message'; // Add class for easy removal

    const timeStr = this.formatTimestamp(timestamp);

     let buttonHtml = '';
    // if (showNewSessionButton) {
    //     buttonHtml = `
    //         <button class="start-new-session-btn" onclick="window.chatWidget.startNewSessionFromButton()">
    //             Start New Conversation
    //         </button>
    //     `;
    // }

    messageEl.innerHTML = `
        <div class="message-content">
            ${content}
            <div class="message-timestamp">${timeStr}</div>
            ${buttonHtml}
        </div>
    `;

    this.chatMessages.appendChild(messageEl);
    this.scrollToBottom();
}

//     async startNewSessionFromButton() {
//     // Remove any existing session timeout messages (same as sendMessage does)
//     const systemMessages = document.querySelectorAll('.message.system');
//     systemMessages.forEach(msg => msg.remove());
//
//     // Start new session automatically (same as sendMessage does)
//     this.startNewSession();
//
//     // Add the same "restarted" message that sendMessage shows
//     await this.addSystemMessage('🔄 New conversation started');
//
//     // Focus input for user to start typing
//     this.chatInput.focus();
// }

    showTypingIndicator() {
        const existingIndicator = document.getElementById('typingIndicator');
        if (existingIndicator) {
            existingIndicator.remove();
        }

        const typingIndicator = document.createElement('div');
        typingIndicator.id = 'typingIndicator';
        typingIndicator.className = 'message bot typing-indicator';
        typingIndicator.style.display = 'flex';
        typingIndicator.innerHTML = `
            <div class="bot-avatar">
                <svg viewBox="0 0 256 256">
                    <path d="M224.32,114.24a56,56,0,0,0-60.07-76.57A56,56,0,0,0,67.93,51.44a56,56,0,0,0-36.25,90.32A56,56,0,0,0,69,217A56.39,56.39,0,0,0,83.59,219a55.75,55.75,0,0,0,8.17-.61a56,56,0,0,0,96.31-13.78,56,56,0,0,0,36.25-90.32ZM182.85,54.43a40,40,0,0,1,28.56,48c-.95-.63-1.91-1.24-2.91-1.81L164,74.88a8,8,0,0,0-8,0l-44,25.41V81.81l40.5-23.38A39.76,39.76,0,0,1,182.85,54.43ZM144,137.24l-16,9.24-16-9.24V118.76l16-9.24,16,9.24ZM80,72a40,40,0,0,1,67.53-29c-1,.51-2,1-3,1.62L100,70.27a8,8,0,0,0-4,6.92V128l-16-9.24ZM40.86,86.93A39.75,39.75,0,0,1,64.12,68.57C64.05,69.71,64,70.85,64,72v51.38a8,8,0,0,0,4,6.93l44,25.4L96,165,55.5,141.57A40,40,0,0,1,40.86,86.93ZM73.15,201.57a40,40,0,0,1-28.56-48c.95.63,1.91,1.24,2.91,1.81L92,181.12a8,8,0,0,0,8,0l44-25.41v18.48l-40.5,23.38A39.76,39.76,0,0,1,73.15,201.57ZM176,184a40,40,0,0,1-67.52,29.05c1-.51,2-1.05,3-1.63L156,185.73a8,8,0,0,0,4-6.92V128l16,9.24Zm39.14-14.93a39.75,39.75,0,0,1-23.26,18.36c.07-1.14.12-2.28.12-3.43V132.62a8,8,0,0,0-4-6.93l-44-25.4,16-9.24,40.5,23.38A40,40,0,0,1,215.14,169.07Z"/>
                </svg>
            </div>
            <div class="message-content">
                <div class="typing-dots">
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                </div>
            </div>
        `;

        if (this.chatMessages) {
            this.chatMessages.appendChild(typingIndicator);
            this.scrollToBottom();
        }
    }

    hideTypingIndicator() {
        const typingIndicator = document.getElementById('typingIndicator');
        if (typingIndicator) {
            typingIndicator.remove();
        }
    }

    scrollToBottom() {
        setTimeout(() => {
            if (this.chatMessages) {
                this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
            }
        }, 100);
    }
}


// Initialize chat widget when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.chatWidget = new ChatWidget();
});

// Enhanced utility functions for testing
window.resetChatData = function() {
    localStorage.removeItem('ghl_contact_id');
    localStorage.removeItem('user_name');
    localStorage.removeItem('user_email');
    localStorage.removeItem('user_phone');
    sessionStorage.removeItem('chat_session_active');
    sessionStorage.removeItem('chat-session-id');
    sessionStorage.removeItem('current_session_id');
    sessionStorage.removeItem('session_start_time');
    sessionStorage.removeItem('session_active');

    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('chat_messages_')) {
            keysToRemove.push(key);
        }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));

    console.log('All chat data and message history reset. Refresh page to test as new user.');
};

window.clearChatHistory = function() {
    const contactId = localStorage.getItem('ghl_contact_id');
    if (contactId) {
        const storageKey = `chat_messages_${contactId}`;
        localStorage.removeItem(storageKey);
        console.log('Chat history cleared for current user.');

        if (window.chatWidget) {
            window.chatWidget.clearMessages();
        }
    } else {
        console.log('No active user found.');
    }
};

window.checkChatData = function() {
    const contactId = localStorage.getItem('ghl_contact_id');
    const userName = localStorage.getItem('user_name');
    const sessionActive = sessionStorage.getItem('chat_session_active');
    const currentSessionId = sessionStorage.getItem('current_session_id');

    let messageCount = 0;
    let messages = [];
    if (contactId) {
        const storageKey = `chat_messages_${contactId}`;
        const storedData = localStorage.getItem(storageKey);
        if (storedData) {
            try {
                const parsedData = JSON.parse(storedData);
                messageCount = parsedData.messages ? parsedData.messages.length : 0;
                messages = parsedData.messages || [];
            } catch (error) {
                console.warn('Error parsing stored messages:', error);
            }
        }
    }

    console.log('Contact ID:', contactId);
    console.log('User Name:', userName);
    console.log('Session Active:', sessionActive);
    console.log('Current Session ID:', currentSessionId);
    console.log('Stored Messages:', messageCount);
    console.log('Supabase Enabled:', window.chatWidget?.isSupabaseEnabled);

    return { contactId, userName, sessionActive, currentSessionId, messageCount, messages };
};

window.viewChatHistory = function() {
    const contactId = localStorage.getItem('ghl_contact_id');
    if (!contactId) {
        console.log('No active user found.');
        return;
    }

    const storageKey = `chat_messages_${contactId}`;
    const storedData = localStorage.getItem(storageKey);

    if (storedData) {
        try {
            const parsedData = JSON.parse(storedData);
            console.log('Chat History for Contact ID:', contactId);
            console.log('Timestamp:', parsedData.timestamp);
            console.log('Messages:');
            parsedData.messages.forEach((msg, index) => {
                console.log(`${index + 1}. [${msg.sender}] ${msg.content} (Session: ${msg.sessionId || 'N/A'})`);
            });
        } catch (error) {
            console.error('Error parsing chat history:', error);
        }
    } else {
        console.log('No chat history found for current user.');
    }
};

// New session management testing functions
window.endCurrentSession = async function() {
    if (window.chatWidget && window.chatWidget.sessionActive) {
        await window.chatWidget.endCurrentSession('manual_test');
        console.log('Current session ended manually');
    } else {
        console.log('No active session to end');
    }
};

window.startNewSession = function() {
    if (window.chatWidget) {
        window.chatWidget.startNewSession();
        console.log('New session started manually');
    } else {
        console.log('Chat widget not available');
    }
};

window.getSessionInfo = function() {
    const sessionId = sessionStorage.getItem('current_session_id');
    const startTime = sessionStorage.getItem('session_start_time');
    const active = sessionStorage.getItem('session_active');

    console.log('Session ID:', sessionId);
    console.log('Start Time:', startTime);
    console.log('Active:', active);
    console.log('Widget Session Active:', window.chatWidget?.sessionActive);

    return { sessionId, startTime, active };
};

// New Supabase testing function
window.testSupabase = async function() {
    if (!window.chatWidget?.isSupabaseEnabled) {
        console.log('Supabase is not enabled. Configure your URL and API key first.');
        return;
    }

    try {
        const { data, error } = await window.chatWidget.supabase
            .from('chat_messages')
            .select('count')
            .limit(1);

        if (error) {
            console.error('Supabase connection failed:', error);
        } else {
            console.log('✅ Supabase connection successful!');
        }
    } catch (error) {
        console.error('Supabase test failed:', error);
    }
};

// Global debug function
window.debugRLS = async function() {
    if (window.chatWidget) {
        await window.chatWidget.debugRLSContext();
    } else {
        console.log('Chat widget not available');
    }
};

// Global test function
window.testContext = async function() {
    if (window.chatWidget) {
        await window.chatWidget.testContextSetting();
    } else {
        console.log('Chat widget not available');
    }
};
