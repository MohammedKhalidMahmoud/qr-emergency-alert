import locationData from '../data/locations.json';

const locations = Array.isArray(locationData.locations) ? locationData.locations : [];

export function getLocations() {
  return locations.slice();
}

export function getLocationById(locationId) {
  return locations.find((location) => location.id === locationId) || null;
}

export function getLocationLabel(locationId) {
  return getLocationById(locationId)?.name || locationId;
}

export function getProjectName() {
  return locationData.project || 'QR Emergency Help';
}
