require('dotenv').config();
const httpClient = require('../utils/httpClient');

class LocationService {
  constructor() {
    this.apiKey = process.env.GOOGLE_MAPS_API_KEY;
    this.baseUrl = 'https://maps.googleapis.com/maps/api';
  }

  // ============================================================================
  // GEOCODING SERVICES
  // ============================================================================

  async geocodeAddress(address) {
    try {
      if (!this.apiKey) {
        console.warn('Google Maps API key not configured');
        return { success: false, error: 'API key not configured' };
      }

      const response = await httpClient.get(`${this.baseUrl}/geocode/json`, {
        params: {
          address: address,
          key: this.apiKey
        }
      });

      if (!response.success) {
        return {
          success: false,
          error: response.error || 'Geocoding request failed'
        };
      }

      if (response.data.status === 'OK' && response.data.results.length > 0) {
        const result = response.data.results[0];
        const location = result.geometry.location;

        return {
          success: true,
          coordinates: {
            latitude: location.lat,
            longitude: location.lng
          },
          formattedAddress: result.formatted_address,
          placeId: result.place_id,
          addressComponents: result.address_components
        };
      } else {
        return {
          success: false,
          error: `Geocoding failed: ${response.data.status}`,
          details: response.data.error_message
        };
      }
    } catch (error) {
      console.error('Geocoding error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async reverseGeocode(latitude, longitude) {
    try {
      if (!this.apiKey) {
        console.warn('Google Maps API key not configured');
        return { success: false, error: 'API key not configured' };
      }

      const response = await httpClient.get(`${this.baseUrl}/geocode/json`, {
        params: {
          latlng: `${latitude},${longitude}`,
          key: this.apiKey
        }
      });

      if (!response.success) {
        return {
          success: false,
          error: response.error || 'Reverse geocoding request failed'
        };
      }

      if (response.data.status === 'OK' && response.data.results.length > 0) {
        const result = response.data.results[0];

        return {
          success: true,
          address: result.formatted_address,
          placeId: result.place_id,
          addressComponents: result.address_components
        };
      } else {
        return {
          success: false,
          error: `Reverse geocoding failed: ${response.data.status}`,
          details: response.data.error_message
        };
      }
    } catch (error) {
      console.error('Reverse geocoding error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // ============================================================================
  // DISTANCE AND DURATION CALCULATION
  // ============================================================================

  async calculateDistance(origin, destination, mode = 'driving') {
    try {
      if (!this.apiKey) {
        console.warn('Google Maps API key not configured');
        // Return estimated distance based on straight-line calculation
        return this.calculateStraightLineDistance(origin, destination);
      }

      // Support different input formats
      const originParam = this.formatLocationParam(origin);
      const destinationParam = this.formatLocationParam(destination);

      const response = await axios.get(`${this.baseUrl}/distancematrix/json`, {
        params: {
          origins: originParam,
          destinations: destinationParam,
          mode: mode,
          units: 'metric',
          key: this.apiKey
        }
      });

      if (response.data.status === 'OK' &&
        response.data.rows.length > 0 &&
        response.data.rows[0].elements.length > 0) {

        const element = response.data.rows[0].elements[0];

        if (element.status === 'OK') {
          return {
            success: true,
            distance: {
              text: element.distance.text,
              value: element.distance.value, // in meters
              kilometers: Math.round(element.distance.value / 1000 * 10) / 10
            },
            duration: {
              text: element.duration.text,
              value: element.duration.value, // in seconds
              minutes: Math.round(element.duration.value / 60)
            },
            mode: mode
          };
        } else {
          return {
            success: false,
            error: `Distance calculation failed: ${element.status}`
          };
        }
      } else {
        return {
          success: false,
          error: `Distance Matrix API failed: ${response.data.status}`,
          details: response.data.error_message
        };
      }
    } catch (error) {
      console.error('Distance calculation error:', error);
      // Fallback to straight-line distance
      return this.calculateStraightLineDistance(origin, destination);
    }
  }

  calculateStraightLineDistance(origin, destination) {
    try {
      const originCoords = this.extractCoordinates(origin);
      const destCoords = this.extractCoordinates(destination);

      if (!originCoords || !destCoords) {
        return {
          success: false,
          error: 'Invalid coordinates for distance calculation'
        };
      }

      const distance = this.haversineDistance(
        originCoords.latitude,
        originCoords.longitude,
        destCoords.latitude,
        destCoords.longitude
      );

      // Estimate driving time (assuming average speed of 40 km/h in city)
      const estimatedMinutes = Math.round((distance / 40) * 60);

      return {
        success: true,
        distance: {
          text: `${distance.toFixed(1)} km`,
          value: distance * 1000, // in meters
          kilometers: distance
        },
        duration: {
          text: `${estimatedMinutes} mins`,
          value: estimatedMinutes * 60, // in seconds
          minutes: estimatedMinutes
        },
        mode: 'estimated',
        note: 'Straight-line distance estimation'
      };
    } catch (error) {
      console.error('Straight-line distance calculation error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // ============================================================================
  // PLACES AUTOCOMPLETE
  // ============================================================================

  async searchPlaces(query, location = null, radius = 50000) {
    try {
      if (!this.apiKey) {
        console.warn('Google Maps API key not configured');
        return { success: false, error: 'API key not configured' };
      }

      const params = {
        input: query,
        key: this.apiKey,
        types: 'establishment|geocode'
      };

      if (location) {
        const coords = this.extractCoordinates(location);
        if (coords) {
          params.location = `${coords.latitude},${coords.longitude}`;
          params.radius = radius;
        }
      }

      const response = await axios.get(`${this.baseUrl}/place/autocomplete/json`, {
        params
      });

      if (response.data.status === 'OK') {
        return {
          success: true,
          predictions: response.data.predictions.map(prediction => ({
            placeId: prediction.place_id,
            description: prediction.description,
            structuredFormatting: prediction.structured_formatting,
            types: prediction.types
          }))
        };
      } else {
        return {
          success: false,
          error: `Places search failed: ${response.data.status}`,
          details: response.data.error_message
        };
      }
    } catch (error) {
      console.error('Places search error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async getPlaceDetails(placeId) {
    try {
      if (!this.apiKey) {
        console.warn('Google Maps API key not configured');
        return { success: false, error: 'API key not configured' };
      }

      const response = await axios.get(`${this.baseUrl}/place/details/json`, {
        params: {
          place_id: placeId,
          fields: 'name,formatted_address,geometry,place_id,types',
          key: this.apiKey
        }
      });

      if (response.data.status === 'OK') {
        const result = response.data.result;
        return {
          success: true,
          place: {
            placeId: result.place_id,
            name: result.name,
            address: result.formatted_address,
            coordinates: {
              latitude: result.geometry.location.lat,
              longitude: result.geometry.location.lng
            },
            types: result.types
          }
        };
      } else {
        return {
          success: false,
          error: `Place details failed: ${response.data.status}`,
          details: response.data.error_message
        };
      }
    } catch (error) {
      console.error('Place details error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  formatLocationParam(location) {
    if (typeof location === 'string') {
      return location;
    }

    if (location.latitude && location.longitude) {
      return `${location.latitude},${location.longitude}`;
    }

    if (location.address) {
      return location.address;
    }

    return location.toString();
  }

  extractCoordinates(location) {
    if (typeof location === 'object') {
      if (location.latitude && location.longitude) {
        return {
          latitude: parseFloat(location.latitude),
          longitude: parseFloat(location.longitude)
        };
      }
      if (location.lat && location.lng) {
        return {
          latitude: parseFloat(location.lat),
          longitude: parseFloat(location.lng)
        };
      }
    }
    return null;
  }

  haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in kilometers
    const dLat = this.degToRad(lat2 - lat1);
    const dLon = this.degToRad(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.degToRad(lat1)) * Math.cos(this.degToRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;

    return distance;
  }

  degToRad(deg) {
    return deg * (Math.PI / 180);
  }

  isValidCoordinates(latitude, longitude) {
    return !isNaN(latitude) && !isNaN(longitude) &&
      latitude >= -90 && latitude <= 90 &&
      longitude >= -180 && longitude <= 180;
  }

  // ============================================================================
  // SPECIALIZED METHODS FOR TAXI BOOKING
  // ============================================================================

  async calculateTripDetails(pickupLocation, dropLocation) {
    try {
      // Get coordinates for both locations if they're addresses
      let pickupCoords = this.extractCoordinates(pickupLocation);
      let dropCoords = this.extractCoordinates(dropLocation);

      // Geocode addresses if coordinates not provided
      if (!pickupCoords && typeof pickupLocation === 'string') {
        const geocoded = await this.geocodeAddress(pickupLocation);
        if (geocoded.success) {
          pickupCoords = geocoded.coordinates;
          pickupLocation = geocoded.formattedAddress;
        }
      }

      if (!dropCoords && typeof dropLocation === 'string') {
        const geocoded = await this.geocodeAddress(dropLocation);
        if (geocoded.success) {
          dropCoords = geocoded.coordinates;
          dropLocation = geocoded.formattedAddress;
        }
      }

      // Calculate distance and duration
      const distanceResult = await this.calculateDistance(
        pickupCoords || pickupLocation,
        dropCoords || dropLocation
      );

      return {
        success: true,
        pickup: {
          address: typeof pickupLocation === 'string' ? pickupLocation : 'Coordinates provided',
          coordinates: pickupCoords
        },
        drop: {
          address: typeof dropLocation === 'string' ? dropLocation : 'Coordinates provided',
          coordinates: dropCoords
        },
        trip: distanceResult.success ? {
          distance: distanceResult.distance,
          duration: distanceResult.duration,
          mode: distanceResult.mode
        } : null,
        error: distanceResult.success ? null : distanceResult.error
      };
    } catch (error) {
      console.error('Trip details calculation error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  detectAirportPickup(address) {
    const airportKeywords = [
      'airport', 'terminal', 'departure', 'arrival',
      'international airport', 'domestic airport'
    ];

    const addressLower = address.toLowerCase();
    return airportKeywords.some(keyword => addressLower.includes(keyword));
  }
}

module.exports = new LocationService(); 