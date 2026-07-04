document.addEventListener('DOMContentLoaded', () => {
    // ----------------------------------------------------
    // DOM REFERENCES
    // ----------------------------------------------------
    const form = document.getElementById('contact-form');
    const nameInput = document.getElementById('contact-name');
    const emailInput = document.getElementById('contact-email');
    const phoneInput = document.getElementById('contact-phone');
    const subjectInput = document.getElementById('contact-subject');
    const messageInput = document.getElementById('contact-message');

    const submitBtn = document.getElementById('submit-btn');
    const errorBanner = document.getElementById('error-banner');
    const errorBannerText = document.getElementById('error-banner-text');
    const successOverlay = document.getElementById('success-overlay');
    const resetFormBtn = document.getElementById('reset-form-btn');

    const payloadDisplay = document.getElementById('payload-display');
    const pipelineSteps = document.querySelectorAll('.pipeline-step');
    const clientNode = document.getElementById('node-client');
    const apiNode = document.getElementById('node-api');
    const emailNode = document.getElementById('node-email');
    const flowDots = document.querySelectorAll('.flow-dot');

    // Initialize Lucide Icons
    lucide.createIcons();

    // Local or Hosted API Endpoint URL
    const API_URL = 'http://localhost:5000/api/contact';


    // ----------------------------------------------------
    // LIVE JSON PAYLOAD INSPECTOR
    // ----------------------------------------------------
    // Function to capture form state and update code block on screen
    function updatePayloadPreview() {
        const botcheckInput = form.querySelector('input[name="botcheck"]');
        const payload = {
            name: nameInput.value || "Waiting for input...",
            email: emailInput.value || "Waiting for input...",
            phone: phoneInput.value || "",
            subject: subjectInput.value || "",
            message: messageInput.value || "Waiting for input...",
            botcheck: botcheckInput ? botcheckInput.value : ""
        };

        payloadDisplay.textContent = JSON.stringify(payload, null, 2);
    }

    // Bind event listeners to input keystrokes
    [nameInput, emailInput, phoneInput, subjectInput, messageInput].forEach(input => {
        input.addEventListener('input', updatePayloadPreview);
    });

    // Run once on load to initialize placeholder JSON structure
    updatePayloadPreview();

    // ----------------------------------------------------
    // PIPELINE STAGES VISUAL ANIMATIONS
    // ----------------------------------------------------
    // Toggles highlights on nodes and flow lines
    function setPipelineVisuals(stepNum) {
        // Clear all step highlights
        pipelineSteps.forEach(s => s.classList.remove('active'));

        // Highlight current textual step
        const currentStepText = document.querySelector(`.pipeline-step[data-step="${stepNum}"]`);
        if (currentStepText) {
            currentStepText.classList.add('active');
            currentStepText.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        // Reset glowing states and line animations
        clientNode.classList.remove('active');
        apiNode.classList.remove('active');
        emailNode.classList.remove('active');
        flowDots[0].style.animation = 'none';
        flowDots[1].style.animation = 'none';

        if (stepNum === 1) {
            clientNode.classList.add('active');
        } else if (stepNum === 2) {
            clientNode.classList.add('active');
            apiNode.classList.add('active');
            flowDots[0].style.animation = 'flowForwardLeft 1.2s infinite linear';
        } else if (stepNum === 3) {
            apiNode.classList.add('active');
        } else if (stepNum === 4) {
            apiNode.classList.add('active');
            emailNode.classList.add('active');
            flowDots[1].style.animation = 'flowForwardRight 1.2s infinite linear';
        }
    }

    // ----------------------------------------------------
    // FORM VALIDATION & SUBMISSION
    // ----------------------------------------------------
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        // 1. Clear previous visual error indicators
        form.querySelectorAll('.input-group').forEach(group => group.classList.remove('invalid'));
        errorBanner.classList.add('hidden');

        let isValid = true;

        // Name verification
        if (!nameInput.value.trim()) {
            document.getElementById('group-name').classList.add('invalid');
            isValid = false;
        }

        // Email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailInput.value.trim() || !emailRegex.test(emailInput.value.trim())) {
            document.getElementById('group-email').classList.add('invalid');
            isValid = false;
        }

        // Message verification
        if (!messageInput.value.trim()) {
            document.getElementById('group-message').classList.add('invalid');
            isValid = false;
        }

        if (!isValid) {
            // Trigger a physical shake animation on the form layout
            form.style.animation = 'none';
            setTimeout(() => {
                form.style.animation = 'shake 0.4s ease';
            }, 10);

            errorBannerText.innerText = "Please fill out the highlighted fields correctly before submitting.";
            errorBanner.classList.remove('hidden');
            return;
        }

        // 2. Client-side verified! Start animation pipeline
        setPipelineVisuals(1); // Step 1: Input validated

        // Disable input elements and show loading spinner on submit button
        form.querySelectorAll('input, textarea, button').forEach(el => el.disabled = true);
        const submitBtnText = submitBtn.querySelector('.btn-text');
        const submitBtnIcon = submitBtn.querySelector('.btn-icon');
        const submitBtnLoader = submitBtn.querySelector('.btn-loader');

        submitBtnText.innerText = "Connecting API...";
        submitBtnIcon.classList.add('hidden');
        submitBtnLoader.classList.remove('hidden');

        const botcheckInput = form.querySelector('input[name="botcheck"]');

        // Compile payload
        const payload = {
            name: nameInput.value.trim(),
            email: emailInput.value.trim(),
            phone: phoneInput.value.trim(),
            subject: subjectInput.value.trim(),
            message: messageInput.value.trim(),
            botcheck: botcheckInput ? botcheckInput.value : ""
        };

        // Delay slightly so the user can see Step 1 animation
        setTimeout(async () => {
            // Step 2: Dispatch API Request (Browser -> Express API)
            setPipelineVisuals(2);
            submitBtnText.innerText = "Sending Data...";

            try {
                // Perform HTTP POST to our local Node.js Express server
                const response = await fetch(API_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    body: JSON.stringify(payload)
                });

                const data = await response.json();

                if (response.ok && data.success) {
                    // Step 3: Server parses data
                    submitBtnText.innerText = "Server Processing...";
                    setPipelineVisuals(3);

                    setTimeout(() => {
                        // Step 4: SMTP Dispatch (Express API -> Inbox)
                        setPipelineVisuals(4);
                        submitBtnText.innerText = "Delivering Email...";

                        setTimeout(() => {
                            // Success! Overlay completion window
                            successOverlay.classList.remove('hidden');

                            // Restore button
                            submitBtnText.innerText = "Submit to Local Backend";
                            submitBtnIcon.classList.remove('hidden');
                            submitBtnLoader.classList.add('hidden');
                        }, 1200);

                    }, 1200);

                } else {
                    // API returned error status code (e.g. 400 or 500)
                    throw new Error(data.message || 'API failed to process form submission.');
                }

            } catch (err) {
                console.error("API submission error:", err);

                // Reset server visuals to client node
                setPipelineVisuals(1);

                // Re-enable inputs
                form.querySelectorAll('input, textarea, button').forEach(el => el.disabled = false);
                submitBtnText.innerText = "Submit to Local Backend";
                submitBtnIcon.classList.remove('hidden');
                submitBtnLoader.classList.add('hidden');

                // Display error
                errorBannerText.innerText = `Backend Error: ${err.message}. (Make sure your Node server is running on port 5000!)`;
                errorBanner.classList.remove('hidden');

                // Shake form
                form.style.animation = 'none';
                setTimeout(() => {
                    form.style.animation = 'shake 0.4s ease';
                }, 10);
            }

        }, 1000);
    });

    // ----------------------------------------------------
    // CLOSE SUCCESS OVERLAY
    // ----------------------------------------------------
    resetFormBtn.addEventListener('click', () => {
        successOverlay.classList.add('hidden');
        form.reset();

        // Re-enable inputs
        form.querySelectorAll('input, textarea, button').forEach(el => el.disabled = false);

        // Reset pipeline steps visual highlight to step 1
        setPipelineVisuals(1);
        updatePayloadPreview();
    });
});
