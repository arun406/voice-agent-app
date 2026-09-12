import { Injectable } from '@angular/core';

declare const window: any;

/** Hands off to Google Maps for turn-by-turn directions to a GIS point (feeder, pole, job site, ...). */
@Injectable({ providedIn: 'root' })
export class MapsService {
  openDirections(latitude: number, longitude: number, label?: string): void {
    // label is accepted for callers/UI copy but Google's directions URL API only
    // takes a lat/lng or place ID for `destination` — a free-text label there would
    // ask Maps to geocode the label itself, discarding the coordinates we already have.
    void label;
    const destination = `${latitude},${longitude}`;
    const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;

    // '_system' hands the URL to the OS, which opens the Google Maps app if installed
    // (falls back to a browser otherwise) — this app doesn't need its own map view.
    if (window.cordova?.InAppBrowser) {
      window.cordova.InAppBrowser.open(url, '_system');
    } else {
      window.open(url, '_system');
    }
  }
}
