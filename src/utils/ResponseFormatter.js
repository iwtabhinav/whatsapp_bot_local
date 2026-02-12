/**
 * ResponseFormatter - Handles all WhatsApp message format generation
 * Implements the PRD specifications for rich message formats
 */

class ResponseFormatter {
    /**
     * Create an interactive list message
     * @param {string|Object} headerOrConfig - Header text or config object
     * @param {string} body - Body text (if first param is string)
     * @param {Array} rows - List rows (if first param is string)
     * @returns {Object} WhatsApp list message format
     */
    static createListMessage(headerOrConfig, body, rows) {
        let config;

        // Handle both old format (string, string, array) and new format (object)
        if (typeof headerOrConfig === 'string') {
            config = {
                header: headerOrConfig,
                body: body || "Choose your service:",
                rows: rows || []
            };
        } else {
            config = headerOrConfig;
        }

        const {
            header = "🚗 VIP Chauffeur Services",
            body: configBody = "Choose your service:",
            footer = "Select an option below",
            rows: configRows = [],
            buttonText = "Select"
        } = config;

        // Convert rows to sections format
        const sections = [{
            title: header,
            rows: configRows.map(row => ({
                id: row.id,
                title: row.title,
                description: row.description
            }))
        }];

        return {
            text: configBody,
            sections: sections,
            buttonText: buttonText,
            headerType: 1
        };
    }

    /**
     * Create a button message
     * @param {Object} config - Button message configuration
     * @returns {Object} WhatsApp button message format
     */
    static createButtonMessage(config) {
        const {
            header = "📋 Action Required",
            body = "Please choose an action:",
            footer = "VIP Chauffeur Services",
            buttons = []
        } = config;

        return {
            text: `${header}\n\n${body}\n\n${footer}`,
            buttons: buttons.map(button => ({
                buttonId: button.id,
                buttonText: { displayText: button.text },
                type: button.type || 1
            })),
            headerType: 1
        };
    }

    /**
     * Create a location message
     * @param {Object} config - Location message configuration
     * @returns {Object} WhatsApp location message format
     */
    static createLocationMessage(config) {
        const {
            latitude,
            longitude,
            name = "Location",
            address = "",
            accuracy = 100
        } = config;

        return {
            location: {
                degreesLatitude: latitude,
                degreesLongitude: longitude,
                name: name,
                address: address
            }
        };
    }

    /**
     * Create a payment message with link
     * @param {Object} config - Payment message configuration
     * @returns {Object} WhatsApp payment message format
     */
    static createPaymentMessage(config) {
        const {
            amount,
            currency = "AED",
            description = "Booking Payment",
            paymentLink = "",
            bookingId = ""
        } = config;

        return {
            text: `💳 *Payment Required*\n\n` +
                `*Amount:* ${currency} ${amount}\n` +
                `*Description:* ${description}\n` +
                `*Booking ID:* ${bookingId}\n\n` +
                `Click the link below to complete payment:\n${paymentLink}`,
            buttons: [
                {
                    buttonId: "pay_now",
                    buttonText: { displayText: "💳 Pay Now" },
                    type: 1
                },
                {
                    buttonId: "view_details",
                    buttonText: { displayText: "📋 View Details" },
                    type: 1
                }
            ],
            headerType: 1
        };
    }

    /**
     * Create a media message with preview
     * @param {Object} config - Media message configuration
     * @returns {Object} WhatsApp media message format
     */
    static createMediaMessage(config) {
        const {
            type = "image", // image, video, document
            url,
            caption = "",
            thumbnail = null
        } = config;

        const mediaConfig = {
            [type]: { url: url },
            caption: caption
        };

        if (thumbnail) {
            mediaConfig.thumbnail = thumbnail;
        }

        return mediaConfig;
    }

    /**
     * Create a service selection list
     * @returns {Object} Service selection list message
     */
    static createServiceSelectionList() {
        return this.createListMessage({
            header: "🚗 Choose Your Service",
            body: "Select the type of chauffeur service you need:",
            footer: "VIP Chauffeur Services",
            sections: [
                {
                    title: "Service Types",
                    rows: [
                        {
                            id: "airport_transfer",
                            title: "✈️ Airport Transfer",
                            description: "Pickup from/to Dubai Airport"
                        },
                        {
                            id: "point_to_point",
                            title: "📍 Point to Point",
                            description: "Direct pickup and drop-off"
                        },
                        {
                            id: "full_day",
                            title: "🌅 Full Day Service",
                            description: "10-hour chauffeur service"
                        },
                        {
                            id: "hourly",
                            title: "⏰ Hourly Service",
                            description: "Flexible hourly bookings"
                        }
                    ]
                }
            ],
            buttonText: "Select Service"
        });
    }

    /**
     * Create a vehicle selection list
     * @returns {Object} Vehicle selection list message
     */
    static createVehicleSelectionList() {
        return this.createListMessage({
            header: "🚗 Choose Your Vehicle",
            body: "Select your preferred vehicle type:",
            footer: "All vehicles include professional chauffeur",
            sections: [
                {
                    title: "Vehicle Options",
                    rows: [
                        {
                            id: "sedan",
                            title: "🚗 Sedan",
                            description: "AED 120 base + AED 3/km • 4 passengers"
                        },
                        {
                            id: "suv",
                            title: "🚙 SUV",
                            description: "AED 180 base + AED 4/km • 6 passengers"
                        },
                        {
                            id: "luxury",
                            title: "✨ Luxury (Maybach)",
                            description: "AED 350 base + AED 8/km • 4 passengers"
                        },
                        {
                            id: "van",
                            title: "🚐 Van",
                            description: "AED 220 base + AED 5/km • 8+ passengers"
                        }
                    ]
                }
            ],
            buttonText: "Select Vehicle"
        });
    }

    /**
     * Create a booking confirmation buttons
     * @param {Object} bookingDetails - Booking details to confirm
     * @returns {Object} Booking confirmation button message
     */
    static createBookingConfirmationButtons(bookingDetails) {
        return this.createButtonMessage({
            header: "📋 Booking Confirmation",
            body: `Please confirm your booking details:\n\n` +
                `👤 Guest: ${bookingDetails.guestName || 'Not specified'}\n` +
                `🚗 Vehicle: ${bookingDetails.vehicleType || 'Not specified'}\n` +
                `📍 From: ${bookingDetails.pickupLocation || 'Not specified'}\n` +
                `🎯 To: ${bookingDetails.dropLocation || 'Not specified'}\n` +
                `🕐 Time: ${bookingDetails.pickupTime || 'Not specified'}`,
            footer: "VIP Chauffeur Services",
            buttons: [
                {
                    id: "confirm_booking",
                    text: "✅ Confirm Booking",
                    type: 1
                },
                {
                    id: "modify_booking",
                    text: "✏️ Modify Details",
                    type: 1
                },
                {
                    id: "cancel_booking",
                    text: "❌ Cancel",
                    type: 1
                }
            ]
        });
    }

    /**
     * Create a location request message
     * @returns {Object} Location request message
     */
    static createLocationRequestMessage() {
        return {
            text: "📍 *Location Required*\n\n" +
                "Please share your pickup location so we can:\n" +
                "• Calculate accurate pricing\n" +
                "• Provide precise pickup time\n" +
                "• Send the nearest chauffeur\n\n" +
                "You can:\n" +
                "• Share your current location\n" +
                "• Type the address\n" +
                "• Send a location pin",
            buttons: [
                {
                    buttonId: "share_location",
                    buttonText: { displayText: "📍 Share Location" },
                    type: 1
                },
                {
                    buttonId: "type_address",
                    buttonText: { displayText: "✏️ Type Address" },
                    type: 1
                }
            ],
            headerType: 1
        };
    }

    /**
     * Create a help message with quick actions
     * @returns {Object} Help message with buttons
     */
    static createHelpMessage() {
        return this.createButtonMessage({
            header: "🤖 VIP Chauffeur Bot Help",
            body: "I'm here to help you book your chauffeur service. Choose an option:",
            footer: "Available 24/7",
            buttons: [
                {
                    id: "book_now",
                    text: "🚗 Book Now",
                    type: 1
                },
                {
                    id: "get_quote",
                    text: "💰 Get Quote",
                    type: 1
                },
                {
                    id: "contact_support",
                    text: "📞 Contact Support",
                    type: 1
                },
                {
                    id: "view_services",
                    text: "📋 View Services",
                    type: 1
                }
            ]
        });
    }
}

module.exports = ResponseFormatter;
