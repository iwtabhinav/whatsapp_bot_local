const { Client } = require('@googlemaps/google-maps-services-js');

class GoogleMapsService {
  constructor() {
    this.client = new Client({});
    this.apiKey = process.env.GOOGLE_MAPS_API_KEY;
  }

  async calculateDistance(origin, destination) {
    // Skip call if API key missing or placeholder
    if (!this.apiKey || /your[_-]?google[_-]?maps[_-]?api[_-]?key/i.test(this.apiKey)) {
      console.warn('⚠️ Google Maps API key not found. Using mock distance.');
      return { distanceKm: 25, estimatedTime: '30 mins' };
    }

    try {
      const response = await this.client.distancematrix({
        params: {
          origins: [origin],
          destinations: [destination],
          key: this.apiKey,
        },
      });

      const element = response.data.rows[0].elements[0];
      if (element.status === 'OK') {
        return {
          distanceKm: Math.round((element.distance.value / 1000) * 100) / 100,
          estimatedTime: element.duration.text,
        };
      } else {
        return { distanceKm: null, estimatedTime: null };
      }
    } catch (error) {
      console.error('❌ Error calculating distance with Google Maps:', error);
      return { distanceKm: null, estimatedTime: null };
    }
  }
}

module.exports = new GoogleMapsService();
