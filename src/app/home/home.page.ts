import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { Vault, VaultType, ErrorCode } from '@capawesome-team/capacitor-vault';
import {
  AlertController,
  IonButton,
  IonButtons,
  IonContent,
  IonFab,
  IonFabButton,
  IonHeader,
  IonIcon,
  IonItem,
  IonItemOption,
  IonItemOptions,
  IonItemSliding,
  IonLabel,
  IonList,
  IonNote,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import type { PluginListenerHandle } from '@capacitor/core';
import { addIcons } from 'ionicons';
import {
  addOutline,
  lockClosedOutline,
  lockOpenOutline,
  trashOutline,
} from 'ionicons/icons';

interface Entry {
  site: string;
  username: string;
  password: string;
}

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  imports: [
    IonButton,
    IonButtons,
    IonContent,
    IonFab,
    IonFabButton,
    IonHeader,
    IonIcon,
    IonItem,
    IonItemOption,
    IonItemOptions,
    IonItemSliding,
    IonLabel,
    IonList,
    IonNote,
    IonTitle,
    IonToolbar,
  ],
})
export class HomePage implements OnInit, OnDestroy {
  readonly entries = signal<Entry[]>([]);
  readonly isLocked = signal(true);

  private listeners: PluginListenerHandle[] = [];

  constructor(private readonly alertController: AlertController) {
    addIcons({
      'add-outline': addOutline,
      'lock-closed-outline': lockClosedOutline,
      'lock-open-outline': lockOpenOutline,
      'trash-outline': trashOutline,
    });
  }

  async ngOnInit(): Promise<void> {
    await Vault.initialize({
      type: VaultType.Biometric,
      title: 'Unlock your passwords',
      cancelButtonText: 'Cancel',
      iosFallbackButtonText: 'Use Passcode',
      lockAfterBackgrounded: 30_000,
    });
    const { isLocked } = await Vault.isLocked();
    this.isLocked.set(isLocked);
    if (!isLocked) {
      await this.loadEntries();
    }
    this.listeners.push(
      await Vault.addListener('lock', () => {
        this.entries.set([]);
        this.isLocked.set(true);
      }),
      await Vault.addListener('unlock', async () => {
        this.isLocked.set(false);
        await this.loadEntries();
      }),
    );
  }

  async ngOnDestroy(): Promise<void> {
    await Vault.removeAllListeners();
  }

  async addEntry(): Promise<void> {
    const alert = await this.alertController.create({
      header: 'Add Password',
      inputs: [
        { name: 'site', placeholder: 'Site (e.g. github.com)', type: 'text' },
        { name: 'username', placeholder: 'Username', type: 'text' },
        { name: 'password', placeholder: 'Password', type: 'password' },
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Save',
          handler: async data => {
            if (!data.site || !data.password) {
              return false;
            }
            await Vault.setValue({
              key: data.site,
              value: JSON.stringify({
                site: data.site,
                username: data.username ?? '',
                password: data.password,
              }),
            });
            await this.loadEntries();
            return true;
          },
        },
      ],
    });
    await alert.present();
  }

  async deleteEntry(entry: Entry): Promise<void> {
    await Vault.removeValue({ key: entry.site });
    await this.loadEntries();
  }

  async lock(): Promise<void> {
    await Vault.lock();
  }

  async revealEntry(entry: Entry): Promise<void> {
    const alert = await this.alertController.create({
      header: entry.site,
      message: `Username: ${entry.username || '(none)'}\nPassword: ${entry.password}`,
      buttons: ['Close'],
      cssClass: 'reveal-alert',
    });
    await alert.present();
  }

  async unlock(): Promise<void> {
    try {
      await Vault.unlock();
    } catch (error: any) {
      if (error?.code === ErrorCode.UnlockCanceled) {
        return;
      }
      if (error?.code === ErrorCode.KeyInvalidated) {
        await Vault.destroy();
        await this.showError(
          'Biometric set changed. The vault has been reset.',
        );
        return;
      }
      await this.showError(error?.message ?? 'Failed to unlock.');
    }
  }

  private async loadEntries(): Promise<void> {
    const { keys } = await Vault.getKeys();
    const entries: Entry[] = [];
    for (const key of keys) {
      const { value } = await Vault.getValue({ key });
      if (value) {
        try {
          entries.push(JSON.parse(value) as Entry);
        } catch {
          // skip corrupt entries
        }
      }
    }
    entries.sort((a, b) => a.site.localeCompare(b.site));
    this.entries.set(entries);
  }

  private async showError(message: string): Promise<void> {
    const alert = await this.alertController.create({
      header: 'Error',
      message,
      buttons: ['OK'],
    });
    await alert.present();
  }
}
