const axios = require('axios');

class HttpClient {
    constructor() {
        this.defaultTimeout = 30000; // 30 seconds
        this.defaultHeaders = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': 'Preimo-Chauffeur-Services/1.0'
        };
    }

    async request(method, url, data = null, options = {}) {
        try {
            const config = {
                method: method.toLowerCase(),
                url: url,
                timeout: options.timeout || this.defaultTimeout,
                headers: { ...this.defaultHeaders, ...options.headers },
                ...options
            };

            if (data) {
                if (method.toLowerCase() === 'get') {
                    config.params = data;
                } else {
                    config.data = data;
                }
            }

            const response = await axios(config);

            return {
                success: true,
                data: response.data,
                status: response.status,
                headers: response.headers
            };
        } catch (error) {
            console.error(`HTTP ${method.toUpperCase()} request failed:`, {
                url,
                error: error.message,
                status: error.response?.status,
                data: error.response?.data
            });

            return {
                success: false,
                error: error.message,
                status: error.response?.status,
                data: error.response?.data
            };
        }
    }

    async get(url, params = null, options = {}) {
        return this.request('GET', url, params, options);
    }

    async post(url, data = null, options = {}) {
        return this.request('POST', url, data, options);
    }

    async put(url, data = null, options = {}) {
        return this.request('PUT', url, data, options);
    }

    async patch(url, data = null, options = {}) {
        return this.request('PATCH', url, data, options);
    }

    async delete(url, options = {}) {
        return this.request('DELETE', url, null, options);
    }

    // Convenience method for form data
    async postForm(url, formData, options = {}) {
        return this.post(url, formData, {
            ...options,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                ...options.headers
            }
        });
    }

    // Convenience method for file uploads
    async upload(url, formData, options = {}) {
        return this.post(url, formData, {
            ...options,
            headers: {
                'Content-Type': 'multipart/form-data',
                ...options.headers
            }
        });
    }
}

module.exports = new HttpClient();
