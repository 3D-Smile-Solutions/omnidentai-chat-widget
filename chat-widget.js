console.log('🚀 CHAT WIDGET VERSION: 3.0 - EMAIL FIRST FLOW + BOT CONTROL');

class ChatWidget {
    constructor() {
        this.isOpen = false;
        this.messages = [];
        this.webhookUrl = 'https://n8n.3dsmilesolutions.ai/webhook/omnidentai';
        this.formWebhookUrl = 'https://n8n.3dsmilesolutions.ai/webhook/form-submit';
        this.metricsWebhookUrl = 'https://n8n.3dsmilesolutions.ai/webhook/extract-metrics';
        this.codeVerificationUrl = 'https://n8n.3dsmilesolutions.ai/webhook/verify-code';
        this.crmBackendUrl = 'http://localhost:5000'; 
        this.isSending = false;
        this.maxStoredMessages = 100;
        this.messageExpiryDays = 30;

        // Session management
        this.currentSessionId = null;
        this.sessionStartTime = null;
        this.inactivityTimeout = null;
        this.inactivityDuration = 2 * 60 * 1000;
        this.sessionActive = false;

        // Message pagination
        this.messagesOffset = 0;
        this.messageLimit = 25;
        this.hasMoreMessages = true;
        this.isLoadingMore = false;

        // Supabase configuration
        this.supabaseUrl = 'https://qdrxmkfcajqenzdxejhp.supabase.co';
        this.supabaseKey = 'sb_publishable_QKwYCf7_uuRqSIzIopv91A_Y_kjKsho';
        this.supabase = null;
        this.isSupabaseEnabled = false;

        // Resend timer
        this.resendCooldown = false;
        this.resendTimer = null;
        this.resendCountdown = 60;

        // Sound properties
        this.soundsEnabled = true;
        this.isFirstLoad = true;

        // Message polling
        this.messagePollingInterval = null;
        this.pollingActive = false;

        // WebSocket properties
        this.socket = null;
        this.socketConnected = false;

        this.init();
    }

    // ================================
    // SECTION: INITIALIZATION
    // ================================

   async init() {
    console.log('🔧 Init started...');
    
    await this.initSupabase();

    // Get all DOM elements
    this.chatButton = document.getElementById('chatButton');
    this.chatWindow = document.getElementById('chatWindow');
    this.closeBtn = document.getElementById('closeBtn');
    this.chatInput = document.getElementById('chatInput');
    this.sendBtn = document.getElementById('sendBtn');
    this.chatMessages = document.getElementById('chatMessages');
    this.messagePrompt = document.getElementById('messagePrompt');

    this.formOverlay = document.getElementById('chatFormOverlay');
    this.chatForm = document.getElementById('chatForm');
    this.formLoading = document.getElementById('formLoading');
    this.formSubmitBtn = document.getElementById('formSubmitBtn');

    // Verify critical elements
    if (!this.chatButton) {
        console.error('❌ Chat button not found!');
        return;
    }
    if (!this.chatWindow) {
        console.error('❌ Chat window not found!');
        return;
    }

    console.log('✅ All DOM elements found');

    this.loadMoreContainer = null;
    this.loadMoreBtn = null;
    this.createLoadMoreButton();

    // Bind events AFTER elements are confirmed to exist
    this.bindEvents();
    this.setupFormHandlers();
    
    console.log('✅ Events bound successfully');
    console.log('✅ Widget initialization complete');
}

    async initSupabase() {
        try {
            if (this.supabaseUrl !== 'YOUR_SUPABASE_URL' && this.supabaseKey !== 'YOUR_SUPABASE_ANON_KEY') {
                this.supabase = window.supabase.createClient(this.supabaseUrl, this.supabaseKey);
                this.isSupabaseEnabled = true;
            } else {
                console.log('Supabase not configured - using localStorage fallback');
                this.isSupabaseEnabled = false;
            }
        } catch (error) {
            console.warn('Supabase initialization failed, using localStorage fallback:', error);
            this.isSupabaseEnabled = false;
        }
    }

    initSounds() {
        this.soundsEnabled = true;
        console.log('Sounds enabled');
    }

    playSound(type) {
        if (!this.soundsEnabled || this.isFirstLoad) return;

        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            if (type === 'send') {
                oscillator.frequency.value = 1200;
                gainNode.gain.setValueAtTime(0.20, audioContext.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.05);
                oscillator.start();
                oscillator.stop(audioContext.currentTime + 0.05);
            } else if (type === 'receive') {
                oscillator.frequency.value = 800;
                gainNode.gain.setValueAtTime(0.08, audioContext.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.15);
                oscillator.start();
                oscillator.stop(audioContext.currentTime + 0.15);
            }
        } catch (error) {
            console.warn('Sound failed:', error);
        }
    }

    // ================================
    // SECTION: EMAIL CHECK & NEW FORMS
    // ================================

async checkEmailExists(email) {
    console.log('🔍 Checking if email exists:', email);
    
    if (!this.isSupabaseEnabled) {
        console.warn('⚠️ Supabase not initialized yet, waiting...');
        await new Promise(resolve => setTimeout(resolve, 500));
        
        if (!this.isSupabaseEnabled) {
            console.error('❌ Supabase failed to initialize');
            return { exists: false, error: 'Database not available' };
        }
    }

    // Rate limiting
    const lastCheck = sessionStorage.getItem('last_email_check');
    const lastEmail = sessionStorage.getItem('last_checked_email');
    const now = Date.now();
    
    if (lastCheck && lastEmail === email && (now - parseInt(lastCheck)) < 2000) {
        console.warn('⚠️ Rate limit: Waiting before rechecking same email');
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    sessionStorage.setItem('last_email_check', now.toString());
    sessionStorage.setItem('last_checked_email', email);

    // ✅ HIPAA-COMPLIANT: Use secure function instead of direct query
    const maxRetries = 3;
    let attempt = 0;
    
    while (attempt < maxRetries) {
        try {
            console.log(`🔄 Attempt ${attempt + 1}/${maxRetries}`);
            
            // ✅ Call the secure function
            const { data, error } = await this.supabase
                .rpc('check_email_exists', { check_email: email.trim() });

            console.log('📦 Function response:', { data, error });

            if (error) {
                console.error(`❌ Error on attempt ${attempt + 1}:`, error);
                
                if (attempt < maxRetries - 1) {
                    attempt++;
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    continue;
                }
                
                return { exists: false, error: error.message };
            }

            // data = { exists: true/false, contact_id: 'xxx' or null }
            if (!data || !data.exists) {
                console.log('✅ Email NOT in database - new user');
                return { exists: false };
            }

            console.log('✅ Email FOUND - existing user');
            
            // Now fetch the full name using the contact_id (with proper RLS context)
            await this.setUserContext(data.contact_id);
            
            const { data: userData, error: userError } = await this.supabase
                .from('user_profiles')
                .select('first_name, last_name, email')
                .eq('contact_id', data.contact_id)
                .single();

            if (userError || !userData) {
                console.warn('Could not fetch user details');
                return {
                    exists: true,
                    contactId: data.contact_id,
                    fullName: 'User',
                    email: email
                };
            }

            return { 
                exists: true, 
                contactId: data.contact_id,
                firstName: userData.first_name,
                lastName: userData.last_name,
                fullName: `${userData.first_name} ${userData.last_name}`,
                email: userData.email
            };

        } catch (error) {
            console.error(`❌ Exception on attempt ${attempt + 1}:`, error);
            
            if (attempt < maxRetries - 1) {
                attempt++;
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue;
            }
            
            return { exists: false, error: error.message };
        }
    }
    
    return { exists: false, error: 'Max retries exceeded' };
}

    validateEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return false;
        }
        if (email.length > 254) return false;
        return true;
    }
showEmailOnlyForm() {
    console.log('📧 showEmailOnlyForm() called');
    
    // ✅ CRITICAL: Open the chat window FIRST
    this.isOpen = true;
    this.chatWindow.classList.add('active');
    console.log('✅ Chat window activated');
    
    // Hide message prompt
    this.messagePrompt.classList.add('hidden');
    
    // ✅ Show the overlay
    if (this.formOverlay) {
        this.formOverlay.classList.remove('hidden');
        this.formOverlay.style.display = 'flex';
        console.log('✅ Form overlay displayed');
    } else {
        console.error('❌ Form overlay not found!');
        return;
    }

    const formContainer = this.formOverlay.querySelector('.form-container');
    if (!formContainer) {
        console.error('❌ Form container not found!');
        return;
    }

    console.log('✅ Building email form...');
    
    formContainer.innerHTML = `
        <div class="form-logo-top">
            <img src="https://cdn.jsdelivr.net/gh/3dsmilesolutions/omnidentai-chat-widget@main/assets/OmniDent%20AI%20Logo.svg" alt="Company Logo" class="logo-image-top">
        </div>

        <div class="form-header">
            <h3>Welcome! 👋</h3>
            <p>Enter your email to get started</p>
        </div>

        <form class="chat-form" id="emailCheckForm">
            <div class="form-group">
                <label for="userEmailCheck">Email Address *</label>
                <input 
                    type="email" 
                    id="userEmailCheck" 
                    name="email" 
                    required 
                    placeholder="Enter your email"
                    autocomplete="email"
                >
            </div>

            <button type="submit" class="form-submit-btn" id="emailCheckBtn">
                Continue
            </button>
        </form>

        <div class="form-loading" id="emailCheckLoading" style="display: none;">
            <div class="loading-spinner"></div>
            <p>Checking your email...</p>
        </div>
    `;

    console.log('✅ Email form HTML injected');

    const emailForm = document.getElementById('emailCheckForm');
    const emailLoading = document.getElementById('emailCheckLoading');

    if (emailForm) {
        console.log('✅ Email form found, binding submit handler');
        emailForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            console.log('📨 Email form submitted');
            
            const email = document.getElementById('userEmailCheck').value.trim();
            
            if (!this.validateEmail(email)) {
                this.showFormError('Please enter a valid email address');
                return;
            }

            emailForm.style.display = 'none';
            emailLoading.style.display = 'flex';

            const result = await this.checkEmailExists(email);

            emailLoading.style.display = 'none';

            if (result.rateLimited) {
                this.showFormError('Please wait a moment before trying again');
                emailForm.style.display = 'flex';
                return;
            }

            if (result.exists) {
                console.log('✅ Existing user - sending verification code');
                
                sessionStorage.setItem('temp_email', email);
                sessionStorage.setItem('temp_user_name', result.fullName);
                sessionStorage.setItem('temp_contact_id', result.contactId);

                await this.sendVerificationCodeExistingUser(email, result.fullName, result.contactId);
                
            } else {
                console.log('✅ New user - showing full registration form');
                sessionStorage.setItem('temp_email', email);
                this.showFullRegistrationForm(email);
            }
        });
    } else {
        console.error('❌ Could not find email form after injection!');
    }

    setTimeout(() => {
        const emailInput = document.getElementById('userEmailCheck');
        if (emailInput) {
            this.addSpacebarFixToInput(emailInput);
            emailInput.focus();
            console.log('✅ Email input focused');
        }
    }, 100);
}

    async sendVerificationCodeExistingUser(email, name, contactId) {
        try {
            const response = await fetch(this.formWebhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: email,
                    name: name,
                    contact_id: contactId,
                    existing_user: true
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP error: ${response.status}`);
            }

            const data = await response.json();

           console.log('✅ data.success:', data.success);
console.log('✅ data.verification_sent:', data.verification_sent);

if (!data.success || !data.verification_sent) {
    console.error('❌ FAILED CHECK - Showing email form');
    this.showFormError(data.message || 'Failed to send verification code.');
    this.showEmailOnlyForm();
    return;
}

console.log('✅ SUCCESS - Calling showVerificationForm()');
this.showVerificationForm(email, name, '');
console.log('✅ showVerificationForm() completed');

        } catch (error) {
            console.error('Error sending verification code:', error);
            this.showFormError('Failed to send verification code. Please try again.');
            this.showEmailOnlyForm();
        }
    }

   showFullRegistrationForm(email = '') {
    console.log('🚨 FULL FORM CALLED - Email:', email);
    console.trace('📍 Call stack:'); 

    console.log('📝 showFullRegistrationForm() called with email:', email);
    
    // ✅ Ensure chat window is active
    this.isOpen = true;
    this.chatWindow.classList.add('active');
    this.messagePrompt.classList.add('hidden');
    
    if (this.formOverlay) {
        this.formOverlay.classList.remove('hidden');
        this.formOverlay.style.display = 'flex';
        console.log('✅ Form overlay shown');
    } else {
        console.error('❌ Form overlay not found!');
        return;
    }
    
    const formContainer = this.formOverlay.querySelector('.form-container');
    if (!formContainer) {
        console.error('❌ Form container not found!');
        return;
    }

    console.log('✅ Form container found, injecting HTML...');

    formContainer.innerHTML = `
        <div class="form-logo-top">
            <img src="https://cdn.jsdelivr.net/gh/3dsmilesolutions/omnidentai-chat-widget@main/assets/OmniDent%20AI%20Logo.svg" alt="Company Logo" class="logo-image-top">
        </div>

        <div class="form-header">
            <h3>Complete Your Profile</h3>
            <p>Tell us a bit more about yourself</p>
        </div>

        <form class="chat-form" id="chatForm">
            <div class="form-row">
                <div class="form-group half-width">
                    <label for="userName">Full Name *</label>
                    <input type="text" id="userName" name="name" required placeholder="Enter your full name">
                </div>
                <div class="form-group half-width">
                    <label for="userEmail">Email Address *</label>
                    <input type="email" id="userEmail" name="email" required placeholder="Enter your email" value="${email}" ${email ? 'readonly style="background-color: #f3f4f6; cursor: not-allowed;"' : ''}>
                </div>
            </div>

            <div class="form-row">
                <div class="form-group half-width">
                    <label for="userPhone">Phone Number *</label>
                    <input type="tel" id="userPhone" name="phone" required placeholder="Enter your phone number">
                </div>
                <div class="form-group half-width">
                    <label for="userZipCode">Zip Code *</label>
                    <input type="text" id="userZipCode" name="zipCode" required placeholder="Enter your zip code" maxlength="10">
                </div>
            </div>

            <div class="form-row">
                <div class="form-group half-width">
                    <label for="userGender">Identify as... *</label>
                    <select id="userGender" name="gender" required>
                        <option value="">Select gender</option>
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                        <option value="non-binary">Non-Binary</option>
                    </select>
                </div>
                <div class="form-group half-width">
                    <label for="userAge">Age *</label>
                    <input type="number" id="userAge" name="age" required placeholder="Enter your age" min="1" max="120">
                </div>
            </div>

            <div class="consent-group">
                <label class="consent-checkbox">
                    <input type="checkbox" name="marketingConsent" required id="marketingConsent">
                    <span class="custom-checkbox"></span>
                    <span class="consent-text">I consent to receive appointment reminders and practice updates by text and email via OmniDent AI. My data is secured under HIPAA. Reply STOP to unsubscribe. *</span>
                </label>
                <div id="consentError" style="color: #ef4444; font-size: 12px; margin-top: 4px; display: none; padding-left: 36px;">You must consent to continue</div>
                <div style="font-size: 12px; color: #64748b; margin-top: 8px; padding-left: 36px; line-height: 1.4;">
                    By continuing, you agree to our <a href="https://www.omnident.ai/terms-and-conditions" target="_blank" style="color: #34d399; text-decoration: underline;">Terms of Service</a> and <a href="https://www.omnident.ai/terms-and-conditions" target="_blank" style="color: #34d399; text-decoration: underline;">Privacy Policy</a>.
                </div>
            </div>

            <button type="submit" class="form-submit-btn">
                Create Account
            </button>
        </form>

        <div class="form-loading" id="formLoading" style="display: none;">
            <div class="loading-spinner"></div>
            <p>Setting up your account...</p>
        </div>
    `;

    console.log('✅ HTML injected, binding form...');

    this.chatForm = document.getElementById('chatForm');
    this.formLoading = document.getElementById('formLoading');
    
    if (this.chatForm) {
        console.log('✅ Form found, adding submit handler');
        this.chatForm.addEventListener('submit', (e) => {
            e.preventDefault();
            console.log('📤 Full form submitted');
            this.handleFormSubmission();
        });
    } else {
        console.error('❌ Could not find chatForm after injection!');
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
            console.log('✅ Name input focused');
        }
    }, 100);
}
    // ================================
    // SECTION: EXISTING FORM HANDLERS
    // ================================

    getMarketingConsent() {
        const consentCheckbox = document.querySelector('input[name="marketingConsent"]');
        return consentCheckbox ? consentCheckbox.checked : false;
    }

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
            await this.setUserContext(contactId);

            const { data, error } = await this.supabase
                .from('user_profiles')
                .select('*')
                .eq('contact_id', contactId)
                .single();

            if (error) {
                if (error.code !== 'PGRST116') {
                    console.error('Error loading user profile:', error);
                }
                return null;
            }

            return data;
        } catch (error) {
            console.error('Error in loadUserProfile:', error);
            return null;
        }
    }

    parseMarkdownLinks(text) {
        return text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" style="color: rgb(17,35,89); text-decoration: underline; font-weight: 600;">$1</a>');
    }

    // ================================
    // SECTION: MESSAGE POLLING
    // ================================

    startIncomingMessagePolling() {
        const contactId = localStorage.getItem('ghl_contact_id');
        if (!contactId || this.messagePollingInterval || !this.isSupabaseEnabled) return;

        this.pollingActive = true;

        this.messagePollingInterval = setInterval(async () => {
            if (this.pollingActive) {
                await this.checkForIncomingMessages();
            }
        }, 2000);

        this.checkForIncomingMessages();
    }

    async checkForIncomingMessages() {
        const contactId = localStorage.getItem('ghl_contact_id');
        if (!contactId || !this.isSupabaseEnabled || !this.pollingActive) return;

        if (this.isCheckingMessages) return;
        this.isCheckingMessages = true;

        try {
            await this.setUserContext(contactId);

            const thirtySecondsAgo = new Date(Date.now() - 30 * 1000).toISOString();

            const { data, error } = await this.supabase
                .from('chat_messages')
                .select('*')
                .eq('contact_id', contactId)
                .eq('delivered', false)
                .in('sender', ['bot', 'client', 'dentist'])
                .gte('created_at', thirtySecondsAgo)
                .order('created_at', { ascending: false })
                .limit(1);

            if (error) {
                console.warn('Error checking for incoming messages:', error);
                return;
            }

            if (data && data.length > 0) {
                const latestMessage = data[0];
                
                this.addMessageToDOM(latestMessage.message, latestMessage.sender, latestMessage.created_at);

                if (!this.isOpen) {
                    this.showNewMessageNotification();
                }

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

    showNewMessageNotification() {
        if (this.messagePrompt) {
            this.messagePrompt.textContent = "New message! 💬";
            this.messagePrompt.classList.remove('hidden');

            this.chatButton.style.animation = 'chatButtonGlow 1s ease-in-out 3';

            setTimeout(() => {
                this.chatButton.style.animation = '';
            }, 3000);
        }
    }

    stopIncomingMessagePolling() {
        this.pollingActive = false;

        if (this.messagePollingInterval) {
            clearInterval(this.messagePollingInterval);
            this.messagePollingInterval = null;
            console.log('Stopped message polling');
        }
    }
    // ================================
    // SECTION: WEBSOCKET INTEGRATION
    // ================================

    async initWebSocket() {
        const contactId = localStorage.getItem('ghl_contact_id');
        
        if (!contactId || this.socket) {
            return;
        }

        try {
            if (!window.io) {
                await this.loadSocketIO();
            }

            console.log('🔌 Connecting widget to WebSocket...');

            this.socket = window.io(this.crmBackendUrl, {
                auth: {
                    contactId: contactId
                },
                transports: ['websocket', 'polling']
            });

            this.socket.on('connect', () => {
                console.log('✅ Widget connected to WebSocket');
                this.socketConnected = true;
            });

            this.socket.on('new_message', (data) => {
                console.log('📩 Received message via WebSocket:', data);
                
                this.addMessageToDOM(data.message, data.sender, data.timestamp);
                
                if (!this.isOpen) {
                    this.showNewMessageNotification();
                }
                
                this.scrollToBottom();
                
                if (data.sender === 'dentist' || data.sender === 'bot') {
                    this.playSound('receive');
                }
            });

            this.socket.on('message_sent', (data) => {
                console.log('✅ Message sent confirmation:', data);
            });

            this.socket.on('message_error', (data) => {
                console.error('❌ Message error:', data);
            });

            this.socket.on('disconnect', (reason) => {
                console.log('🔌 Widget disconnected:', reason);
                this.socketConnected = false;
            });

            this.socket.on('connect_error', (error) => {
                // console.error('❌ WebSocket connection error:', error);
                this.socketConnected = false;
            });

        } catch (error) {
            console.error('❌ Failed to initialize WebSocket:', error);
        }
    }

    async loadSocketIO() {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.socket.io/4.5.4/socket.io.min.js';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    disconnectWebSocket() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
            this.socketConnected = false;
            console.log('🔌 WebSocket disconnected');
        }
    }

    // ================================
    // SECTION: SESSION MANAGEMENT
    // ================================

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

        await this.addSystemMessage(
            '⏰ This conversation has ended due to inactivity. Send a message to start a new conversation.',
            false
        );
    }

    async endCurrentSession(reason = 'manual') {
        if (!this.sessionActive || !this.currentSessionId) return;

        const sessionEndTime = new Date().toISOString();
        this.sessionActive = false;

        if (this.inactivityTimeout) {
            clearTimeout(this.inactivityTimeout);
            this.inactivityTimeout = null;
        }

        await this.triggerMetricsExtraction(
            this.currentSessionId,
            localStorage.getItem('ghl_contact_id'),
            this.sessionStartTime,
            sessionEndTime,
            reason
        );

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

    // ================================
    // SECTION: MESSAGE LOADING
    // ================================

    createLoadMoreButton() {
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

            await this.setUserContext(contactId);

            const newOffset = this.messagesOffset + this.messageLimit;

            const { data, error } = await this.supabase
                .from('chat_messages')
                .select('*')
                .eq('contact_id', contactId)
                .order('created_at', { ascending: false })
                .range(newOffset, newOffset + this.messageLimit - 1);

            if (error) throw error;

            if (data && data.length > 0) {
                const scrollHeight = this.chatMessages.scrollHeight;
                const scrollTop = this.chatMessages.scrollTop;

                const olderMessages = data.reverse();

                const newMessages = olderMessages.map(msg => ({
                    content: msg.message,
                    sender: msg.sender,
                    timestamp: msg.created_at,
                    sessionId: msg.session_id
                }));

                this.messages = [...newMessages, ...this.messages];

                olderMessages.forEach(msg => {
                    this.addMessageToDOM(msg.message, msg.sender, msg.created_at, true);
                });

                const newScrollHeight = this.chatMessages.scrollHeight;
                this.chatMessages.scrollTop = scrollTop + (newScrollHeight - scrollHeight);

                this.messagesOffset = newOffset;

                if (data.length < this.messageLimit) {
                    this.hasMoreMessages = false;
                    this.loadMoreContainer.style.display = 'none';
                }

                console.log(`Loaded ${data.length} more messages. Total: ${this.messages.length}`);
            } else {
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
            const { data, error } = await this.supabase.rpc('set_user_context', {
                contact_id: contactId,
                email: email
            });

            if (error) {
                console.error('Failed to set user context:', error);
                return false;
            }

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

    async loadChatHistory() {
        const contactId = localStorage.getItem('ghl_contact_id');
        if (!contactId) return;

        this.messagesOffset = 0;
        this.hasMoreMessages = true;
        this.loadMoreContainer.style.display = 'none';

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
            const recentMessages = data.reverse();

            this.messages = recentMessages.map(msg => ({
                content: msg.message,
                sender: msg.sender === 'client' ? 'dentist' : msg.sender,
                timestamp: msg.created_at,
                sessionId: msg.session_id
            }));

            this.messages.forEach(msg => {
                this.addMessageToDOM(msg.content, msg.sender, msg.timestamp);
            });

            if (data.length === this.messageLimit) {
                this.loadMoreContainer.style.display = 'block';
            }
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

    async saveChatHistory() {
        const contactId = localStorage.getItem('ghl_contact_id');
        if (!contactId) return;

        if (this.isSupabaseEnabled) {
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

        if (sender === 'user') {
            this.playSound('send');
        }

        // if (this.isSupabaseEnabled && sender === 'bot') {
        //     await this.saveMessageToSupabase(content, sender, timestamp);
        // }
if (this.isSupabaseEnabled) {
    await this.saveMessageToSupabase(content, sender, timestamp);
}

        this.saveChatHistory();

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
        const email = localStorage.getItem('user_email');

        if (!contactId || !email) {
            console.warn('Missing contact ID or email for message save');
            return;
        }

        try {
            const contextSet = await this.setUserContext(contactId);
            if (!contextSet) {
                console.error('Failed to set context before message save');
                return;
            }

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

                const debugInfo = await this.debugRLSContext();
                console.log('RLS Debug Info:', debugInfo);
            }
        } catch (error) {
            console.warn('Error saving to Supabase:', error);
        }
    }

    async saveUserMessageToDatabase(content, contactId) {
        if (!this.isSupabaseEnabled) {
            console.log('Supabase not enabled, skipping message save');
            return;
        }

        try {
            await this.setUserContext(contactId);

            const { error } = await this.supabase
                .from('chat_messages')
                .insert({
                    contact_id: contactId,
                    user_email: localStorage.getItem('user_email'),
                    session_id: this.getCurrentSessionId(),
                    message: content,
                    sender: 'user',
                    channel: 'webchat',
                    created_at: new Date().toISOString(),
                    delivered: true
                });

            if (error) {
                console.warn('Failed to save user message to Supabase:', error);
            } else {
                console.log('✅ User message saved to database');
            }
        } catch (error) {
            console.warn('Error saving user message:', error);
        }
    }

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

            return data;
        } catch (error) {
            console.error('Debug error:', error);
            return null;
        }
    }

    // ================================
    // SECTION: CHAT WINDOW CONTROL
    // ================================

  bindEvents() {
    console.log('🔗 Binding events...');
    
    if (!this.chatButton) {
        console.error('❌ Cannot bind events - chatButton is null');
        return;
    }

    // Chat button click
    this.chatButton.addEventListener('click', () => {
        console.log('🖱️ Chat button clicked!');
        this.toggleChat();
    });
    console.log('✅ Chat button click handler attached');
    // Track activity when user focuses input
    if (this.chatInput) {
        this.chatInput.addEventListener('focus', () => {
            this.updateLastActivity();
        });
        
        // Track activity when user types
        this.chatInput.addEventListener('input', () => {
            this.updateLastActivity();
        });
    }

    // Close button
    if (this.closeBtn) {
        this.closeBtn.addEventListener('click', () => this.closeChat());
    }

    // Send button
    if (this.sendBtn) {
        this.sendBtn.addEventListener('click', () => this.sendMessage());
    }

    // Message prompt
    if (this.messagePrompt) {
        this.messagePrompt.addEventListener('click', () => this.openChat());
    }

    // Chat input
    if (this.chatInput) {
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
    }

    // Click outside to close
    document.addEventListener('click', (e) => {
        if (this.isOpen && 
            !this.chatWindow.contains(e.target) && 
            !this.chatButton.contains(e.target)) {
            this.closeChat();
        }
    });
    
    console.log('✅ All event handlers bound');
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
    console.log('📂 openChat() called');
    
    const contactId = localStorage.getItem('ghl_contact_id');
    const userName = localStorage.getItem('user_name');
    const emailVerified = localStorage.getItem('email_verified');
    const verificationTimestamp = localStorage.getItem('verification_timestamp');
    
    // ✅ FIX: Check BOTH session keys (defensive programming)
    const sessionActive1 = sessionStorage.getItem('chat_session_active');
    const sessionActive2 = sessionStorage.getItem('session_active');
    const sessionActive = sessionActive1 === 'true' || sessionActive2 === 'true';
    
    // ✅ FIX: Check last activity time
    const lastActivity = sessionStorage.getItem('last_activity');
    const now = Date.now();
    const timeSinceActivity = lastActivity ? (now - parseInt(lastActivity)) : Infinity;
    
    console.log('📊 User State:', {
        contactId: contactId ? '✅' : '❌',
        userName,
        sessionActive,
        emailVerified: emailVerified ? '✅' : '❌',
        timeSinceActivity: timeSinceActivity === Infinity ? 'Never' : `${Math.round(timeSinceActivity / 1000)}s ago`,
        inactivityDuration: `${this.inactivityDuration / 1000}s`
    });

    this.isFirstLoad = true;

    // ✅ SCENARIO 1: Within timeout (< 2 minutes since last activity)
    if (contactId && emailVerified && timeSinceActivity < this.inactivityDuration) {
        console.log('✅ SCENARIO 1: Within timeout - opening chat directly');
        
        // Update last activity
        sessionStorage.setItem('last_activity', now.toString());
        
        this.openChatDirectly();
        return;
    }
    
    // ✅ SCENARIO 2: After timeout but verified recently (< 12 hours)
    const verificationAge = verificationTimestamp ? (now - parseInt(verificationTimestamp)) : Infinity;
    const maxVerificationAge = 12 * 60 * 60 * 1000;  // 12 hours
    
    if (contactId && emailVerified && verificationAge < maxVerificationAge) {
        console.log('✅ SCENARIO 2: After timeout but verified - showing "Yes, that\'s me?"');
        this.showQuickVerification(userName);
        return;
    }
    
    // ✅ SCENARIO 3: Never verified or verification expired - Show email form
    console.log('✅ SCENARIO 3: New user or expired verification - showing email form');
    this.showEmailOnlyForm();
}
// ================================
// SECTION: ACTIVITY TRACKING
// ================================

updateLastActivity() {
    const now = Date.now();
    sessionStorage.setItem('last_activity', now.toString());
    console.log('⏱️ Last activity updated:', new Date(now).toLocaleTimeString());
}

    async openChatDirectly() {
        this.updateLastActivity();
        this.isOpen = true;
        this.chatWindow.classList.add('active');
        this.messagePrompt.classList.add('hidden');
        
        if (this.formOverlay) {
            this.formOverlay.classList.add('hidden');
            this.formOverlay.style.display = 'none';
        }

        this.isFirstLoad = true;

        sessionStorage.setItem('chat_session_active', 'true');

        if (!this.sessionActive || !this.currentSessionId) {
            const existingSessionId = sessionStorage.getItem('current_session_id');
            const sessionActiveFlag = sessionStorage.getItem('session_active');

            if (existingSessionId && sessionActiveFlag === 'true') {
                this.currentSessionId = existingSessionId;
                this.sessionStartTime = sessionStorage.getItem('session_start_time');
                this.sessionActive = true;
                this.resetInactivityTimer();
            } else {
                this.startNewSession();
                console.log('Started new session - no previous session found');
            }
        } else {
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

        await this.initWebSocket();
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

showFullRegistrationForm(email = '') {
    console.log('📝 showFullRegistrationForm() called with email:', email);
    
    // ✅ Ensure chat window is active (CRITICAL - DON'T SKIP THIS!)
    this.isOpen = true;
    this.chatWindow.classList.add('active');
    this.messagePrompt.classList.add('hidden');
    
    if (this.formOverlay) {
        this.formOverlay.classList.remove('hidden');
        this.formOverlay.style.display = 'flex';
        console.log('✅ Form overlay shown');
    } else {
        console.error('❌ Form overlay not found!');
        return;
    }
    
    const formContainer = this.formOverlay.querySelector('.form-container');
    if (!formContainer) {
        console.error('❌ Form container not found!');
        return;
    }

    console.log('✅ Form container found, building form...');

    formContainer.innerHTML = `
        <div class="form-logo-top">
            <img src="https://cdn.jsdelivr.net/gh/3dsmilesolutions/omnidentai-chat-widget@main/assets/OmniDent%20AI%20Logo.svg" alt="Company Logo" class="logo-image-top">
        </div>

        <div class="form-header">
            <h3>Complete Your Profile</h3>
            <p>Tell us a bit more about yourself</p>
        </div>

        <form class="chat-form" id="chatForm">
            <div class="form-row">
                <div class="form-group half-width">
                    <label for="userName">Full Name *</label>
                    <input type="text" id="userName" name="name" required placeholder="Enter your full name">
                </div>
                <div class="form-group half-width">
                    <label for="userEmail">Email Address *</label>
                    <input type="email" id="userEmail" name="email" required placeholder="Enter your email" value="${email}" ${email ? 'readonly style="background-color: #f3f4f6; cursor: not-allowed;"' : ''}>
                </div>
            </div>

            <div class="form-row">
                <div class="form-group half-width">
                    <label for="userPhone">Phone Number *</label>
                    <input type="tel" id="userPhone" name="phone" required placeholder="Enter your phone number">
                </div>
                <div class="form-group half-width">
                    <label for="userZipCode">Zip Code *</label>
                    <input type="text" id="userZipCode" name="zipCode" required placeholder="Enter your zip code" maxlength="10">
                </div>
            </div>

            <div class="form-row">
                <div class="form-group half-width">
                    <label for="userGender">Identify as... *</label>
                    <select id="userGender" name="gender" required>
                        <option value="">Select gender</option>
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                        <option value="non-binary">Non-Binary</option>
                    </select>
                </div>
                <div class="form-group half-width">
                    <label for="userAge">Age *</label>
                    <input type="number" id="userAge" name="age" required placeholder="Enter your age" min="1" max="120">
                </div>
            </div>

            <div class="consent-group">
                <label class="consent-checkbox">
                    <input type="checkbox" name="marketingConsent" required id="marketingConsent">
                    <span class="custom-checkbox"></span>
                    <span class="consent-text">I consent to receive appointment reminders and practice updates by text and email via OmniDent AI. My data is secured under HIPAA. Reply STOP to unsubscribe. *</span>
                </label>
                <div id="consentError" style="color: #ef4444; font-size: 12px; margin-top: 4px; display: none; padding-left: 36px;">You must consent to continue</div>
                <div style="font-size: 12px; color: #64748b; margin-top: 8px; padding-left: 36px; line-height: 1.4;">
                    By continuing, you agree to our <a href="https://www.omnident.ai/terms-and-conditions" target="_blank" style="color: #34d399; text-decoration: underline;">Terms of Service</a> and <a href="https://www.omnident.ai/terms-and-conditions" target="_blank" style="color: #34d399; text-decoration: underline;">Privacy Policy</a>.
                </div>
            </div>

            <button type="submit" class="form-submit-btn">
                Create Account
            </button>
        </form>

        <div class="form-loading" id="formLoading" style="display: none;">
            <div class="loading-spinner"></div>
            <p>Setting up your account...</p>
        </div>
    `;

    console.log('✅ Form HTML injected');

    this.chatForm = document.getElementById('chatForm');
    this.formLoading = document.getElementById('formLoading');
    
    if (this.chatForm) {
        console.log('✅ Binding submit handler');
        this.chatForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleFormSubmission();
        });
    } else {
        console.error('❌ Could not find form element!');
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
            console.log('✅ Name input focused');
        }
    }, 100);
}

showQuickVerification(userName) {
    console.log('⚡ showQuickVerification() called');
    
    // ✅ Ensure chat window is active
    this.isOpen = true;
    this.chatWindow.classList.add('active');
    this.messagePrompt.classList.add('hidden');
    
    if (this.formOverlay) {
        this.formOverlay.classList.remove('hidden');
        this.formOverlay.style.display = 'flex';
    }

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
                this.showEmailOnlyForm();
            });
        }
    }

    showFullFormFromVerification() {
        this.showEmailOnlyForm();
    }

    addVerificationStyles() {
        if (document.querySelector('style[data-verification-form-styles]')) return;

        const style = document.createElement('style');
        style.setAttribute('data-verification-form-styles', 'true');
        style.textContent = `
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

        const consentCheckbox = document.querySelector('input[name="marketingConsent"]');
        if (consentCheckbox && !consentCheckbox.checked) {
            this.showFormError('You must consent to continue', 'consent_required');
            return;
        }

        try {
            const response = await this.submitFormToN8n(userData);

            if (!response.success) {
                this.showFormError(response.message || 'Email not found in our system.');
                return;
            }

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

    async sendVerificationCode(email, name, phone) {
        try {
            const response = await this.submitFormToN8n({
                name: name,
                email: email,
                phone: phone
            });

            if (!response.success || !response.verification_sent) {
                this.showFormError(response.message || 'Failed to send verification code.');
                return;
            }

            this.showVerificationForm(email, name, phone);

        } catch (error) {
            console.error('Error sending verification code:', error);
            this.showFormError('Failed to send verification code. Please try again.');
        }
    }

    showVerificationForm(email, name, phone, zipCode) {
        this.tempZipCode = zipCode;
        this.tempMarketingConsent = this.getMarketingConsent();
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

    setupVerificationHandlers(email, name, phone) {
        const verificationForm = document.getElementById('verificationForm');
        const resendBtn = document.getElementById('resendCodeBtn');
        const codeInput = document.getElementById('verificationCode');

        if (codeInput) {
            codeInput.addEventListener('input', (e) => {
                e.target.value = e.target.value.replace(/[^0-9]/g, '');

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

        if (verificationForm) {
            verificationForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                await this.verifyCode(email, codeInput.value.trim(), name);
            });
        }

        if (resendBtn) {
            resendBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                if (!this.resendCooldown) {
                    await this.handleResendCode(email, name, phone, this.tempZipCode);
                }
            });
        }
    }

    async handleResendCode(email, name, phone) {
        const resendBtn = document.getElementById('resendCodeBtn');
        if (!resendBtn) return;

        try {
            this.startResendCooldown();

            const response = await this.submitFormToN8n({
                name: name,
                email: email,
                phone: phone
            });

            if (!response.success || !response.verification_sent) {
                this.showVerificationError(response.message || 'Failed to send verification code.');
                this.stopResendCooldown();
                return;
            }

            this.showResendSuccess();

        } catch (error) {
            console.error('Error sending verification code:', error);
            this.showVerificationError('Failed to send verification code. Please try again.');
            this.stopResendCooldown();
        }
    }

    startResendCooldown() {
        const resendBtn = document.getElementById('resendCodeBtn');
        if (!resendBtn) return;

        this.resendCooldown = true;
        this.resendCountdown = 60;

        this.createTimerDisplay();

        resendBtn.disabled = true;
        resendBtn.style.opacity = '0.5';
        resendBtn.style.cursor = 'not-allowed';

        this.resendTimer = setInterval(() => {
            this.resendCountdown--;
            this.updateTimerDisplay();

            if (this.resendCountdown <= 0) {
                this.stopResendCooldown();
            }
        }, 1000);

        this.updateTimerDisplay();
    }

    stopResendCooldown() {
        const resendBtn = document.getElementById('resendCodeBtn');

        this.resendCooldown = false;

        if (this.resendTimer) {
            clearInterval(this.resendTimer);
            this.resendTimer = null;
        }

        if (resendBtn) {
            resendBtn.disabled = false;
            resendBtn.style.opacity = '1';
            resendBtn.style.cursor = 'pointer';
            resendBtn.textContent = 'Resend Code';
        }

        this.removeTimerDisplay();
    }

    createTimerDisplay() {
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

        resendBtn.parentNode.insertBefore(timerDiv, resendBtn.nextSibling);
    }

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

    removeTimerDisplay() {
        const timerDiv = document.getElementById('resendTimer');
        if (timerDiv) {
            timerDiv.remove();
        }
    }

    showResendSuccess() {
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

        const formContainer = this.formOverlay.querySelector('.form-container');
        const verificationForm = document.getElementById('verificationForm');

        if (formContainer && verificationForm) {
            formContainer.insertBefore(successDiv, verificationForm);
        }

        setTimeout(() => {
            if (successDiv.parentNode) {
                successDiv.remove();
            }
        }, 3000);
    }

    async verifyCode(email, enteredCode, name) {
        const verificationForm = document.getElementById('verificationForm');
        const verificationLoading = document.getElementById('verificationLoading');

        if (enteredCode.length !== 6) {
            this.showVerificationError('Please enter a 6-digit code.');
            return;
        }

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
                if (verificationLoading) verificationLoading.style.display = 'none';
                if (verificationForm) verificationForm.style.display = 'flex';

                this.showVerificationError(data.message || 'Invalid verification code. Please try again.');

                const codeInput = document.getElementById('verificationCode');
                if (codeInput) {
                    codeInput.value = '';
                    codeInput.focus();
                }
                return;
            }

            localStorage.setItem('ghl_contact_id', data.contact_id);
            localStorage.setItem('user_name', data.user_name);
            localStorage.setItem('user_email', email);
            localStorage.setItem('email_verified', 'true');
            localStorage.setItem('verification_timestamp', Date.now().toString());

            const tempUserData = sessionStorage.getItem('temp_user_data');
            if (tempUserData) {
                try {
                    const userData = JSON.parse(tempUserData);
                    const profileSaved = await this.saveUserProfile(userData);
                    if (profileSaved) {
                        console.log('User profile saved');
                    } else {
                        console.warn('Failed to save user profile to Supabase');
                    }
                    sessionStorage.removeItem('temp_user_data');
                } catch (profileError) {
                    console.error('Error saving user profile:', profileError);
                }
            }

            const authenticated = await this.setUserContext(data.contact_id);
            if (!authenticated) {
                this.showVerificationError('Authentication failed. Please try again.');
                return;
            }

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

    showVerificationError(message) {
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
        const verificationForm = document.getElementById('verificationForm');

        if (formContainer && verificationForm) {
            formContainer.insertBefore(errorDiv, verificationForm);
        }

        setTimeout(() => {
            if (errorDiv.parentNode) {
                errorDiv.remove();
            }
        }, 8000);
    }

    async testDatabaseAccess() {
        if (!this.isSupabaseEnabled) return true;

        try {
            console.log('Testing database access...');

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

    async debugN8nResponse(userData) {
        console.log('=== N8N DEBUG ===');
        console.log('Submitting to N8N:', userData);

        try {
            const response = await this.submitFormToN8n(userData);
            console.log('Raw N8N response:', response);

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

    async validateContactEmailCombo(contactId, email) {
        if (!this.isSupabaseEnabled) {
            return { valid: true, has_previous_messages: false, message: 'Supabase not enabled' };
        }

        try {
            console.log('Validating contact+email combo:', contactId, email);

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
            const validation = await this.validateContactEmailCombo(contactId, email);
            console.log('Validation Result:', validation);

            const { data: allMessages, error } = await this.supabase
                .from('chat_messages')
                .select('contact_id, user_email, created_at')
                .eq('contact_id', contactId);

            if (!error && allMessages) {
                console.log('All messages for this contact_id:', allMessages);
            }

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
        const formElement = formContainer ? formContainer.querySelector('.chat-form, #emailCheckForm') : null;

        if (formContainer && formElement) {
            formContainer.insertBefore(errorDiv, formElement);
        }

        if (errorType === 'duplicate_email' || errorType === 'invalid_email') {
            const emailInput = document.getElementById('userEmail') || document.getElementById('userEmailCheck');
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
            const emailInput = document.getElementById('userEmail') || document.getElementById('userEmailCheck');
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
            zipCode: userData.zipCode || '',
            gender: userData.gender,
            age: userData.age,
            marketingConsent: userData.marketingConsent || false,
            source: 'chat_widget',
            temp_session_id: tempSessionId,
            timestamp: new Date().toISOString(),
            existing_user: userData.existing_user || false
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

        if (data.contact_id) {
            sessionStorage.setItem('chat-session-id', data.contact_id);
        }

        return data;
    }

    async openChatAfterForm(userName, isExistingUser = false) {
    this.formOverlay.classList.add('hidden');
    
    // ✅ FIX: Set BOTH session keys AND last_activity
    sessionStorage.setItem('chat_session_active', 'true');
    sessionStorage.setItem('session_active', 'true');
    sessionStorage.setItem('last_activity', Date.now().toString()); 

        if (this.formOverlay) {
            this.formOverlay.classList.add('hidden');
            this.formOverlay.style.display = 'none';
        }

        const overlayById = document.getElementById('chatFormOverlay');
        if (overlayById) {
            overlayById.classList.add('hidden');
            overlayById.style.display = 'none';
        }

        this.startNewSession();

        this.clearMessagesDisplay();

        const contactId = localStorage.getItem('ghl_contact_id');
        const email = localStorage.getItem('user_email');

        const contextResult = await this.setUserContext(contactId);
        if (!contextResult) {
            this.showVerificationError('Authentication failed. Please try again.');
            return;
        }

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
            const result = await this.setUserContext(contactId);
            console.log('Context set result:', result);

            const debug = await this.debugRLSContext();
            console.log('Debug result:', debug);

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
        this.stopIncomingMessagePolling();
    }

    clearMessagesDisplay() {
        if (this.chatMessages) {
            if (this.loadMoreContainer) {
                this.loadMoreContainer.style.display = 'none';
            }

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

        this.disconnectWebSocket();

        const contactId = localStorage.getItem('ghl_contact_id');
        if (!contactId) {
            setTimeout(() => {
                this.messagePrompt.classList.remove('hidden');
            }, 500);
        }
    }

    // ================================
    // SECTION: MESSAGING
    // ================================

    async sendMessage() {
        this.updateLastActivity();
        const message = this.chatInput.value.trim();
        if (!message || this.isSending) return;

        if (!this.sessionActive) {
            const systemMessages = document.querySelectorAll('.message.system');
            systemMessages.forEach(msg => msg.remove());
            this.startNewSession();
            await this.addSystemMessage('🔄 New conversation started');
        }

        this.isSending = true;
        this.updateSendButton();

        const messageToSend = message;
        this.chatInput.value = '';
        this.chatInput.style.height = 'auto';

        await this.addMessage(messageToSend, 'user');

        const contactId = localStorage.getItem('ghl_contact_id');
        const shouldRespond = await this.shouldBotRespond(contactId);

        console.log('🤖 Bot should respond:', shouldRespond);

        if (this.socketConnected && this.socket) {
            console.log('📤 Sending to CRM via WebSocket');
            this.socket.emit('send_message', {
                content: messageToSend
            });
        }

        if (!shouldRespond) {
            console.log('🛑 Bot paused - message sent to dentist only');
            this.isSending = false;
            this.updateSendButton();
            return;
        }

        console.log('🤖 Bot active - sending to N8N webhook for bot response');
        
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

    async showMessagesSequentially(messages) {
        for (let i = 0; i < messages.length; i++) {
            if (i > 0) {
                this.showTypingIndicator();
                await new Promise(resolve => setTimeout(resolve, 800));
                this.hideTypingIndicator();
            }

            await this.addMessage(messages[i], 'bot');
            
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

        console.log('🔍 Checking if bot should respond for:', contactId);
        const shouldRespond = await this.shouldBotRespond(contactId);
        
        if (!shouldRespond) {
            console.log('🛑 Bot is paused - dentist is handling this conversation');
            return "Your message has been received. A team member will respond shortly.";
        }

        console.log('🤖 Bot is active - sending to N8N webhook');

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

    async shouldBotRespond(contactId) {
        if (!contactId) {
            console.log('⚠️ No contactId - allowing bot to respond');
            return true;
        }

        try {
            const url = `${this.crmBackendUrl}/api/conversation-control/should-respond/${contactId}`;
            console.log('📡 Fetching bot status from:', url);
            
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                }
            });

            console.log('📊 Response status:', response.status);
            console.log('📊 Response ok:', response.ok);

            if (!response.ok) {
                console.warn('⚠️ Failed to check bot control status, defaulting to allow');
                console.warn('⚠️ Response status:', response.status, response.statusText);
                return true;
            }

            const data = await response.json();
            console.log('📦 Response data:', data);
            
            const shouldRespond = data.shouldBotRespond !== false;
            
            console.log(`✅ Final decision: shouldBotRespond = ${shouldRespond}`);
            
            return shouldRespond;

        } catch (error) {
            console.error('❌ Error checking bot control:', error);
            console.error('❌ Error details:', error.message);
            return true;
        }
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

        const displaySender = sender === 'client' ? 'dentist' : sender;
        
        console.log('📩 Displaying as:', displaySender, '(original:', sender + ')');

        const messageEl = document.createElement('div');
        messageEl.className = `message ${displaySender}`;

        const displayTime = timestamp || new Date().toISOString();
        const timeStr = this.formatTimestamp(displayTime);

        const processedContent = this.parseMarkdownLinks(content);

        if (displaySender === 'bot') {
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
        } 
        else if (displaySender === 'dentist') {
            messageEl.innerHTML = `
                <div class="dentist-avatar">
                    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 12C14.21 12 16 10.21 16 8C16 5.79 14.21 4 12 4C9.79 4 8 5.79 8 8C8 10.21 9.79 12 12 12Z" fill="currentColor"/>
                        <path d="M12 14C8.13 14 5 15.79 5 18V20H19V18C19 15.79 15.87 14 12 14Z" fill="currentColor"/>
                    </svg>
                </div>
                <div class="message-content">
                    ${processedContent}
                    <div class="message-timestamp">${timeStr}</div>
                </div>
            `;
        }
        else {
            messageEl.innerHTML = `
                <div class="message-content">
                    ${processedContent}
                    <div class="message-timestamp">${timeStr}</div>
                </div>
            `;
        }

        if (prepend) {
            const firstMessage = this.chatMessages.querySelector('.message');
            if (firstMessage) {
                this.chatMessages.insertBefore(messageEl, firstMessage);
            } else {
                this.chatMessages.appendChild(messageEl);
            }
        } else {
            this.chatMessages.appendChild(messageEl);
            this.scrollToBottom();

            if (displaySender === 'bot' || displaySender === 'dentist') {
                this.playSound('receive');
            }
        }
    }

    addSystemMessageToDOM(content, timestamp, showNewSessionButton = false) {
        if (!this.chatMessages) return;

        const messageEl = document.createElement('div');
        messageEl.className = 'message system session-timeout-message';

        const timeStr = this.formatTimestamp(timestamp);

        let buttonHtml = '';

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

// ================================
// GLOBAL INITIALIZATION
// ================================

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        console.log('🚀 Initializing Chat Widget...');
        window.chatWidget = new ChatWidget();
        console.log('✅ Chat Widget Ready');
    });
} else {
    // DOM already loaded
    console.log('🚀 Initializing Chat Widget (DOM already loaded)...');
    window.chatWidget = new ChatWidget();
    console.log('✅ Chat Widget Ready');
}

// ================================
// UTILITY FUNCTIONS (for testing)
// ================================

window.resetChatData = function() {
    localStorage.removeItem('ghl_contact_id');
    localStorage.removeItem('user_name');
    localStorage.removeItem('user_email');
    localStorage.removeItem('user_phone');
    localStorage.removeItem('email_verified');
    localStorage.removeItem('verification_timestamp');
    sessionStorage.removeItem('chat_session_active');
    sessionStorage.removeItem('chat-session-id');
    sessionStorage.removeItem('current_session_id');
    sessionStorage.removeItem('session_start_time');
    sessionStorage.removeItem('session_active');
    sessionStorage.removeItem('temp_email');
    sessionStorage.removeItem('temp_user_name');
    sessionStorage.removeItem('temp_contact_id');
    sessionStorage.removeItem('temp_user_data');

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
    const userEmail = localStorage.getItem('user_email');
    const sessionActive = sessionStorage.getItem('chat_session_active');
    const currentSessionId = sessionStorage.getItem('current_session_id');
    const emailVerified = localStorage.getItem('email_verified');

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
    console.log('User Email:', userEmail);
    console.log('Email Verified:', emailVerified);
    console.log('Session Active:', sessionActive);
    console.log('Current Session ID:', currentSessionId);
    console.log('Stored Messages:', messageCount);
    console.log('Supabase Enabled:', window.chatWidget?.isSupabaseEnabled);

    return { contactId, userName, userEmail, emailVerified, sessionActive, currentSessionId, messageCount, messages };
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

window.debugRLS = async function() {
    if (window.chatWidget) {
        await window.chatWidget.debugRLSContext();
    } else {
        console.log('Chat widget not available');
    }
};

window.testContext = async function() {
    if (window.chatWidget) {
        await window.chatWidget.testContextSetting();
    } else {
        console.log('Chat widget not available');
    }
};

window.testEmailCheck = async function(email) {
    if (window.chatWidget) {
        const result = await window.chatWidget.checkEmailExists(email);
        console.log('Email check result:', result);
        return result;
    } else {
        console.log('Chat widget not available');
    }
};