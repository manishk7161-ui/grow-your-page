const axios = require('axios');

class ApiProviderService {
  /**
   * Fetch services list from an external provider API v2
   */
  static async fetchServices(apiUrl, apiKey) {
    try {
      // If demo API URL, return mock response for smooth demonstration
      if (apiUrl.includes('demo-panel-provider.com') || apiUrl.includes('demo')) {
        return [
          { service: '101', name: 'Instagram Real Followers [High Quality]', category: 'Instagram Followers', rate: '45.00', min: '100', max: '50000' },
          { service: '102', name: 'Instagram Instant Likes [Fast]', category: 'Instagram Likes', rate: '15.00', min: '50', max: '20000' },
          { service: '201', name: 'YouTube High Retention Views', category: 'YouTube Views', rate: '110.00', min: '500', max: '100000' },
          { service: '301', name: 'Telegram Channel Members [Real]', category: 'Telegram Members', rate: '35.00', min: '100', max: '10000' },
          { service: '401', name: 'Facebook Page Likes + Followers', category: 'Facebook Services', rate: '70.00', min: '200', max: '15000' }
        ];
      }

      const response = await axios.post(apiUrl, new URLSearchParams({
        key: apiKey,
        action: 'services'
      }), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10000
      });

      if (Array.isArray(response.data)) {
        return response.data;
      } else if (response.data && response.data.error) {
        throw new Error(response.data.error);
      } else {
        throw new Error('Invalid response structure from Provider API');
      }
    } catch (err) {
      console.error('Error fetching provider services:', err.message);
      throw err;
    }
  }

  /**
   * Create an order on external provider API
   */
  static async createOrder(apiUrl, apiKey, serviceId, link, quantity) {
    try {
      if (apiUrl.includes('demo-panel-provider.com') || apiUrl.includes('demo')) {
        // Return simulated order ID
        const fakeOrderId = 'ORD-' + Math.floor(100000 + Math.random() * 900000);
        return { order: fakeOrderId };
      }

      const response = await axios.post(apiUrl, new URLSearchParams({
        key: apiKey,
        action: 'add',
        service: serviceId,
        link: link,
        quantity: quantity
      }), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10000
      });

      if (response.data && response.data.order) {
        return { order: response.data.order };
      } else if (response.data && response.data.error) {
        throw new Error(response.data.error);
      } else {
        throw new Error('Failed to create order on provider API');
      }
    } catch (err) {
      console.error('Error creating provider order:', err.message);
      throw err;
    }
  }

  /**
   * Check order status from external provider API
   */
  static async checkOrderStatus(apiUrl, apiKey, providerOrderId) {
    try {
      if (apiUrl.includes('demo-panel-provider.com') || apiUrl.includes('demo')) {
        return {
          charge: '10.00',
          start_count: '1500',
          status: 'Completed',
          remains: '0'
        };
      }

      const response = await axios.post(apiUrl, new URLSearchParams({
        key: apiKey,
        action: 'status',
        order: providerOrderId
      }), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10000
      });

      return response.data;
    } catch (err) {
      console.error('Error checking order status:', err.message);
      throw err;
    }
  }
}

module.exports = ApiProviderService;
