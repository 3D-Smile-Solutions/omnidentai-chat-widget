class ChatWidget {
    constructor() {
        this.isOpen = false;
        this.messages = [];
        this.webhookUrl = 'https://n8n.3dsmilesolutions.ai/webhook/omnidentai';
        this.formWebhookUrl = 'https://n8n.3dsmilesolutions.ai/webhook/form-submit';
        this.metricsWebhookUrl = 'https://n8n.3dsmilesolutions.ai/webhook/extract-metrics';
        this.isSending = false;
        this.maxStoredMessages = 100;
        this.messageExpiryDays = 30;

        // Session management
        this.currentSessionId = null;
        this.sessionStartTime = null;
        this.inactivityTimeout = null;
        this.inactivityDuration = 10 * 60 * 1000; // 10 minutes
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

        // Browser restart detection
        this.lastHeartbeat = null;
        this.heartbeatInterval = null;
        this.heartbeatFrequency = 30000; // 30 seconds

        this.init();
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
        this.formOverlay = document.getElementById('chatFormOverlay');
        this.chatForm = document.getElementById('chatForm');
        this.formLoading = document.getElementById('formLoading');
        this.formSubmitBtn = document.getElementById('formSubmitBtn');

        // Load more messages elements
        this.loadMoreContainer = null;
        this.loadMoreBtn = null;
        this.createLoadMoreButton();

        this.bindEvents();
        this.setupFormHandlers();
        
        // Initialize browser restart detection
        this.initBrowserRestartDetection();
    }

    async initSupabase() {
        try {
            // Only initialize if URLs are properly configured
            if (this.supabaseUrl !== 'YOUR_SUPABASE_URL' && this.supabaseKey !== 'YOUR_SUPABASE_ANON_KEY') {
                this.supabase = window.supabase.createClient(this.supabaseUrl, this.supabaseKey);
                this.isSupabaseEnabled = true;
                console.log('Supabase initialized successfully');
            } else {
                console.log('Supabase not configured - using localStorage fallback');
                this.isSupabaseEnabled = false;
            }
        } catch (error) {
            console.warn('Supabase initialization failed, using localStorage fallback:', error);
            this.isSupabaseEnabled = false;
        }
    }

    // Browser Restart Detection Methods
    initBrowserRestartDetection() {
        // Check for previous session on page load
        this.checkForBrowserRestart();
        
        // Set up heartbeat for current session
        this.startHeartbeat();
        
        // Handle page unload to detect intentional closes vs crashes
        window.addEventListener('beforeunload', () => {
            this.handlePageUnload();
        });
    }

    checkForBrowserRestart() {
        const lastHeartbeat = localStorage.getItem('chat_last_heartbeat');
        const currentSessionId = sessionStorage.getItem('current_session_id');
        const sessionActive = sessionStorage.getItem('session_active');
        
        if (lastHeartbeat && currentSessionId && sessionActive === 'true') {
            const lastHeartbeatTime = new Date(lastHeartbeat);
            const now = new Date();
            const timeSinceLastHeartbeat = now - lastHeartbeatTime;
            
            // If more than 2 minutes since last heartbeat, assume browser was closed/crashed
            if (timeSinceLastHeartbeat > 120000) { // 2 minutes
                console.log('Browser restart detected - triggering metrics extraction');
                this.handleBrowserRestart(currentSessionId, lastHeartbeatTime);
            }
        }
        
        // Clean up the heartbeat timestamp since we've checked it
        localStorage.removeItem('chat_last_heartbeat');
    }

    async handleBrowserRestart(sessionId, lastHeartbeatTime) {
        const contactId = localStorage.getItem('ghl_contact_id');
        const sessionStartTime = sessionStorage.getItem('session_start_time');
        
        if (!sessionId || !contactId) return;

        // Trigger metrics extraction for the interrupted session
        await this.triggerMetricsExtraction(
            sessionId,
            contactId,
            sessionStartTime,
            lastHeartbeatTime.toISOString(),
            'browser_restart'
        );

        // Clear the old session data
        sessionStorage.removeItem('current_session_id');
        sessionStorage.removeItem('session_start_time');
        sessionStorage.removeItem('session_active');
        
        console.log('Previous session metrics extracted due to browser restart');
    }

    startHeartbeat() {
        // Clear any existing heartbeat
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }

        // Start new heartbeat
        this.heartbeatInterval = setInterval(() => {
            this.updateHeartbeat();
        }, this.heartbeatFrequency);

        // Initial heartbeat
        this.updateHeartbeat();
    }

    updateHeartbeat() {
        const now = new Date().toISOString();
        this.lastHeartbeat = now;
        localStorage.setItem('chat_last_heartbeat', now);
    }

    handlePageUnload() {
        // Clear heartbeat to indicate intentional close
        localStorage.removeItem('chat_last_heartbeat');
        
        // Clear heartbeat interval
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
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

        console.log('New session started:', this.currentSessionId);
        this.resetInactivityTimer();
        this.startHeartbeat(); // Start heartbeat for new session
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

        // Show session ended message
        await this.addSystemMessage(
            '⏰ This conversation has ended due to inactivity',
            true
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

        // Clear heartbeat
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
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
        localStorage.removeItem('chat_last_heartbeat');

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
        // No RLS context needed - just log for debugging
        console.log('User context set for contact:', contactId);
        return true;
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

            console.log(`Loaded ${this.messages.length} recent messages from Supabase`);
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

    async saveMessageToSupabase(content, sender, timestamp) {
        const contactId = localStorage.getItem('ghl_contact_id');
        if (!contactId) return;

        try {
            const { error } = await this.supabase
                .from('chat_messages')
                .insert({
                    contact_id: contactId,
                    session_id: this.getCurrentSessionId(),
                    message: content,
                    sender: sender,
                    created_at: timestamp
                });

            if (error) {
                console.warn('Failed to save message to Supabase:', error);
            } else {
                console.log('Message saved to Supabase successfully');
            }
        } catch (error) {
            console.warn('Error saving to Supabase:', error);
        }
    }

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

        if (contactId && sessionActive) {
            this.openChatDirectly();
        } else if (contactId && !sessionActive) {
            this.showQuickVerification(userName);
        } else {
            this.showFullForm();
        }
    }

    async openChatDirectly() {
        this.isOpen = true;
        this.chatWindow.classList.add('active');
        this.messagePrompt.classList.add('hidden');
        this.formOverlay.classList.add('hidden');

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
                console.log('Resumed existing session:', this.currentSessionId);

                // Reset inactivity timer for resumed session
                this.resetInactivityTimer();
                this.startHeartbeat();
            } else {
                // No active session found, start new one
                this.startNewSession();
                console.log('Started new session - no previous session found');
            }
        } else {
            // Session is already active, just reset the inactivity timer
            console.log('Continuing current session:', this.currentSessionId);
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

    addVerificationStyles() {
        if (document.querySelector('style[data-verification-styles]')) return;

        const style = document.createElement('style');
        style.setAttribute('data-verification-styles', 'true');
        style.textContent = `
            .verification-buttons {
                display: flex;
                flex-direction: column;
                gap: 12px;
                margin-top: 20px;
            }

            .verify-yes-btn, .verify-no-btn {
                padding: 14px 20px;
                border: 2px solid;
                border-radius: 8px;
                font-size: 16px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s ease;
            }

            .verify-yes-btn {
                background: linear-gradient(135deg, #34d399 0%, #10b981 100%);
                color: #112359;
                border-color: #34d399;
            }

            .verify-yes-btn:hover {
                transform: translateY(-2px);
                box-shadow: 0 8px 25px rgba(52, 211, 153, 0.4);
            }

            .verify-no-btn {
                background: white;
                color: #64748b;
                border-color: #e2e8f0;
            }

            .verify-no-btn:hover {
                border-color: #cbd5e1;
                color: #475569;
            }
        `;
        document.head.appendChild(style);
    }

    async handleFormSubmission() {
        if (!this.chatForm) return;

        const formData = new FormData(this.chatForm);
        const userData = {
            name: formData.get('name'),
            email: formData.get('email'),
            phone: formData.get('phone') || ''
        };

        if (!userData.name || !userData.email) {
            this.showFormError('Please fill in all required fields.');
            return;
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(userData.email)) {
            this.showFormError('Please enter a valid email address.');
            return;
        }

        if (this.chatForm) {
            this.chatForm.style.display = 'none';
        }
        if (this.formLoading) {
            this.formLoading.style.display = 'flex';
        }

        try {
            const response = await this.submitFormToN8n(userData);

            if (response.success) {
                localStorage.setItem('ghl_contact_id', response.contact_id);
                localStorage.setItem('user_name', response.user_name || userData.name);
                localStorage.setItem('user_email', userData.email);
                if (userData.phone) {
                    localStorage.setItem('user_phone', userData.phone);
                }

                if (response.status === 'existing') {
                    await this.openChatAfterForm(response.user_data?.firstName || userData.name, true);
                } else {
                    this.clearChatHistory();
                    await this.openChatAfterForm(userData.name, false);
                }
            } else {
                this.showFormError(response.message, response.error_type);
            }
        } catch (error) {
            this.showFormError('Network error. Please check your connection and try again.');
        }
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

        if (!data.contact_id) {
            throw new Error('No contact_id received from server');
        }

        sessionStorage.setItem('chat-session-id', data.contact_id);
        return data;
    }

    async openChatAfterForm(userName, isExistingUser = false) {
        this.formOverlay.classList.add('hidden');
        sessionStorage.setItem('chat_session_active', 'true');

        // For new users or after form submission, always start a fresh session
        this.startNewSession();
        console.log('Started new session after form submission');

        this.clearMessagesDisplay();

        if (isExistingUser) {
            await this.loadChatHistory();

            if (this.messages.length === 0) {
                await this.addMessage(`Welcome back, ${userName}! 👋 Great to see you again. How can I help you today?`, 'bot');
            }
        } else {
            await this.addMessage(`Hi ${userName}! 👋 Thanks for providing your details. How can I help you today?`, 'bot');
        }

        this.chatInput.focus();
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

        this.isSending = true;
        this.updateSendButton();

        await this.addMessage(message, 'user');
        this.chatInput.value = '';

        this.showTypingIndicator();

        try {
            const response = await this.fetchBotResponse(message);
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

    async showMessagesSequentially(messages) {
        for (let i = 0; i < messages.length; i++) {
            if (i > 0) {
                this.showTypingIndicator();
                await new Promise(resolve => setTimeout(resolve, 800));
                this.hideTypingIndicator();
            }

            await this.addMessage(messages[i], 'bot');
        }
    }

    async fetchBotResponse(userMessage) {
        const contactId = localStorage.getItem('ghl_contact_id');
        const sessionId = this.getCurrentSessionId();
        const userName = localStorage.getItem('user_name') || 'Chat Visitor';
        const userEmail = localStorage.getItem('user_email') || `${sessionId}@example.com`;

        const payload = {
            message: userMessage,
            contact_id: contactId,
            session_id: sessionId,
            name: userName,
            email: userEmail,
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

        if (sender === 'bot') {
            messageEl.innerHTML = `
                <div class="bot-avatar">
                    <svg viewBox="0 0 256 256">
                        <path d="M224.32,114.24a56,56,0,0,0-60.07-76.57A56,56,0,0,0,67.93,51.44a56,56,0,0,0-36.25,90.32A56,56,0,0,0,69,217A56.39,56.39,0,0,0,83.59,219a55.75,55.75,0,0,0,8.17-.61a56,56,0,0,0,96.31-13.78,56,56,0,0,0,36.25-90.32ZM182.85,54.43a40,40,0,0,1,28.56,48c-.95-.63-1.91-1.24-2.91-1.81L164,74.88a8,8,0,0,0-8,0l-44,25.41V81.81l40.5-23.38A39.76,39.76,0,0,1,182.85,54.43ZM144,137.24l-16,9.24-16-9.24V118.76l16-9.24,16,9.24ZM80,72a40,40,0,0,1,67.53-29c-1,.51-2,1-3,1.62L100,70.27a8,8,0,0,0-4,6.92V128l-16-9.24ZM40.86,86.93A39.75,39.75,0,0,1,64.12,68.57C64.05,69.71,64,70.85,64,72v51.38a8,8,0,0,0,4,6.93l44,25.4L96,165,55.5,141.57A40,40,0,0,1,40.86,86.93ZM73.15,201.57a40,40,0,0,1-28.56-48c.95.63,1.91,1.24,2.91,1.81L92,181.12a8,8,0,0,0,8,0l-44-25.41v18.48l-40.5,23.38A39.76,39.76,0,0,1,73.15,201.57ZM176,184a40,40,0,0,1-67.52,29.05c1-.51,2-1.05,3-1.63L156,185.73a8,8,0,0,0,4-6.92V128l16,9.24Zm39.14-14.93a39.75,39.75,0,0,1-23.26,18.36c.07-1.14.12-2.28.12-3.43V132.62a8,8,0,0,0-4-6.93l-44-25.4,16-9.24,40.5,23.38A40,40,0,0,1,215.14,169.07Z"/>
                    </svg>
                </div>
                <div class="message-content">
                    ${content}
                    <div class="message-timestamp">${timeStr}</div>
                </div>
            `;
        } else {
            messageEl.innerHTML = `
                <div class="message-content">
                    ${content}
                    <div class="message-timestamp">${timeStr}</div>
                </div>
            `;
        }

        if (prepend) {
            // Add to beginning (after load more button)
            const firstMessage = this.chatMessages.querySelector('.message');
            if (firstMessage) {
                this.chatMessages.insertBefore(messageEl, firstMessage);
            } else {
                this.chatMessages.appendChild(messageEl);
            }
        } else {
            // Add to end (normal behavior)
            this.chatMessages.appendChild(messageEl);
            this.scrollToBottom();
        }
    }

    addSystemMessageToDOM(content, timestamp, showNewSessionButton = false) {
        if (!this.chatMessages) return;

        const messageEl = document.createElement('div');
        messageEl.className = 'message system';

        const timeStr = this.formatTimestamp(timestamp);

        let buttonHtml = '';
        if (showNewSessionButton) {
            buttonHtml = `
                <button class="start-new-session-btn" onclick="window.chatWidget.startNewSessionFromButton()">
                    Start New Conversation
                </button>
            `;
        }

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

    async startNewSessionFromButton() {
        // End current session if active
        if (this.sessionActive) {
            await this.endCurrentSession('manual_restart');
        }

        // Start new session
        this.startNewSession();

        // Add welcome message for new session
        const userName = localStorage.getItem('user_name') || 'there';
        await this.addMessage(`Hi ${userName}! 👋 I'm ready to help you with a fresh conversation. What can I assist you with?`, 'bot');

        // Focus input
        this.chatInput.focus();
    }

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
    localStorage.removeItem('chat_last_heartbeat');

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
    const lastHeartbeat = localStorage.getItem('chat_last_heartbeat');

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
    console.log('Last Heartbeat:', lastHeartbeat);
    console.log('Stored Messages:', messageCount);
    console.log('Supabase Enabled:', window.chatWidget?.isSupabaseEnabled);

    return { contactId, userName, sessionActive, currentSessionId, lastHeartbeat, messageCount, messages };
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
    const lastHeartbeat = localStorage.getItem('chat_last_heartbeat');

    console.log('Session ID:', sessionId);
    console.log('Start Time:', startTime);
    console.log('Active:', active);
    console.log('Last Heartbeat:', lastHeartbeat);
    console.log('Widget Session Active:', window.chatWidget?.sessionActive);

    return { sessionId, startTime, active, lastHeartbeat };
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

// Browser restart testing function
window.simulateBrowserRestart = function() {
    // Simulate what happens during a browser restart
    localStorage.setItem('chat_last_heartbeat', new Date(Date.now() - 300000).toISOString()); // 5 minutes ago
    sessionStorage.setItem('current_session_id', 'test_session_12345');
    sessionStorage.setItem('session_active', 'true');
    sessionStorage.setItem('session_start_time', new Date(Date.now() - 600000).toISOString()); // 10 minutes ago
    
    console.log('Browser restart simulation set up. Refresh the page to trigger restart detection.');
};

window.checkHeartbeat = function() {
    const lastHeartbeat = localStorage.getItem('chat_last_heartbeat');
    if (lastHeartbeat) {
        const heartbeatTime = new Date(lastHeartbeat);
        const now = new Date();
        const timeSince = now - heartbeatTime;
        
        console.log('Last Heartbeat:', heartbeatTime.toISOString());
        console.log('Time Since Last Heartbeat:', Math.round(timeSince / 1000), 'seconds');
        console.log('Heartbeat Active:', window.chatWidget?.heartbeatInterval !== null);
    } else {
        console.log('No heartbeat found');
    }
};
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
            <div class="form-header">
                <h3>Let's get started!</h3>
                <p>Please provide your details to begin chatting</p>
            </div>

            <form class="chat-form" id="chatForm">
                <div class="form-group">
                    <label for="userName">Full Name *</label>
                    <input type="text" id="userName" name="name" required placeholder="Enter your full name">
                </div>

                <div class="form-group">
                    <label for="userEmail">Email Address *</label>
                    <input type="email" id="userEmail" name="email" required placeholder="Enter your email">
                </div>

                <div class="form-group">
                    <label for="userPhone">Phone Number</label>
                    <input type="tel" id="userPhone" name="phone" placeholder="Enter your phone number">
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

                   
window.ChatWidget = ChatWidget;
