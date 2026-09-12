import { Injectable } from '@angular/core';

declare const navigator: any;
declare const Camera: any;

/** Wraps cordova-plugin-camera for taking or choosing a photo to describe. */
@Injectable({ providedIn: 'root' })
export class PhotoService {
  /** Opens the camera. Resolves with an absolute filesystem path to the captured JPEG. */
  takePhoto(): Promise<string> {
    return this.getPicture(Camera?.PictureSourceType?.CAMERA ?? 1);
  }

  /** Opens the photo gallery/library. Resolves with an absolute filesystem path. */
  choosePhoto(): Promise<string> {
    return this.getPicture(Camera?.PictureSourceType?.PHOTOLIBRARY ?? 0);
  }

  private getPicture(sourceType: number): Promise<string> {
    if (!navigator.camera) {
      return Promise.reject(new Error('Camera not available in this browser.'));
    }
    return new Promise((resolve, reject) => {
      navigator.camera.getPicture(
        (fileUri: string) => resolve(fileUri.replace(/^file:\/\//, '').replace(/\?.*$/, '')),
        (err: unknown) => reject(new Error(String(err))),
        {
          quality: 60,
          destinationType: Camera?.DestinationType?.FILE_URI ?? 1,
          sourceType,
          correctOrientation: true,
          targetWidth: 1024,
          targetHeight: 1024
        }
      );
    });
  }
}
