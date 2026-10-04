import { Component, OnDestroy, OnInit, computed, signal, ChangeDetectionStrategy } from '@angular/core';
import {
  Vault,
  VaultType,
  ErrorCode,
  type LockEvent,
  type UnlockEvent,
} from '@capawesome-team/capacitor-vault';
import {
  AlertController,
  ToastController,
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
  IonSegment,
  IonSegmentButton,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
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

interface VaultDescriptor {
  id: string;
  label: string;
}

interface VaultState {
  isLocked: boolean;
  entries: Entry[];
}

const VAULTS: VaultDescriptor[] = [
  { id: 'personal', label: 'Personal' },
  { id: 'work', label: 'Work' },
];

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
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
    IonSegment,
    IonSegmentButton,
    IonTitle,
    IonToolbar,
  ],
})
export class HomePage implements OnInit, OnDestroy {
  readonly vaults = VAULTS;
  readonly activeVaultId = signal<string>(VAULTS[0].id);
  readonly states = signal<Record<string, VaultState>>(
    VAULTS.reduce<Record<string, VaultState>>((acc, v) => {
      acc[v.id] = { isLocked: true, entries: [] };
      return acc;
    }, {}),
  );

  readonly activeVault = computed(
    () => VAULTS.find(v => v.id === this.activeVaultId()) ?? VAULTS[0],
  );
  readonly activeState = computed(() => this.states()[this.activeVaultId()]);

  private listeners: PluginListenerHandle[] = [];

  constructor(
    private readonly alertController: AlertController,
    private readonly toastController: ToastController,
  ) {
    addIcons({
      'add-outline': addOutline,
      'lock-closed-outline': lockClosedOutline,
      'lock-open-outline': lockOpenOutline,
      'trash-outline': trashOutline,
    });
  }

  async ngOnInit(): Promise<void> {
    for (const vault of VAULTS) {
      await Vault.initialize({
        vaultId: vault.id,
        type: VaultType.Biometric,
        title: `Unlock your ${vault.label.toLowerCase()} passwords`,
        cancelButtonText: 'Cancel',
        iosFallbackButtonText: 'Use Passcode',
        lockAfterBackgrounded: 0,
      });
      const { isLocked } = await Vault.isLocked({ vaultId: vault.id });
      const entries = isLocked ? [] : await this.fetchEntries(vault.id);
      this.updateState(vault.id, { isLocked, entries });
    }
    this.listeners.push(
      await Vault.addListener('lock', event => this.handleLock(event)),
      await Vault.addListener('unlock', event => this.handleUnlock(event)),
    );
  }

  async ngOnDestroy(): Promise<void> {
    await Vault.removeAllListeners();
  }

  async addEntry(): Promise<void> {
    const vaultId = this.activeVaultId();
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
              vaultId,
              key: data.site,
              value: JSON.stringify({
                site: data.site,
                username: data.username ?? '',
                password: data.password,
              }),
            });
            await this.refreshEntries(vaultId);
            return true;
          },
        },
      ],
    });
    await alert.present();
  }

  async deleteEntry(entry: Entry): Promise<void> {
    const vaultId = this.activeVaultId();
    await Vault.removeValue({ vaultId, key: entry.site });
    await this.refreshEntries(vaultId);
  }

  async lock(): Promise<void> {
    await Vault.lock({ vaultId: this.activeVaultId() });
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

  setActiveVault(vaultId: string | number | undefined): void {
    if (typeof vaultId === 'string' && this.states()[vaultId]) {
      this.activeVaultId.set(vaultId);
    }
  }

  async unlock(): Promise<void> {
    const vaultId = this.activeVaultId();
    try {
      await Vault.unlock({ vaultId });
    } catch (error: any) {
      if (error?.code === ErrorCode.UnlockCanceled) {
        return;
      }
      if (error?.code === ErrorCode.KeyInvalidated) {
        await Vault.destroy({ vaultId });
        await this.showError(
          'Biometric set changed. The vault has been reset.',
        );
        return;
      }
      await this.showError(error?.message ?? 'Failed to unlock.');
    }
  }

  private async fetchEntries(vaultId: string): Promise<Entry[]> {
    const { keys } = await Vault.getKeys({ vaultId });
    const entries: Entry[] = [];
    for (const key of keys) {
      const { value } = await Vault.getValue({ vaultId, key });
      if (value) {
        try {
          entries.push(JSON.parse(value) as Entry);
        } catch {
          // skip corrupt entries
        }
      }
    }
    entries.sort((a, b) => a.site.localeCompare(b.site));
    return entries;
  }

  private async handleLock(event: LockEvent): Promise<void> {
    const descriptor = VAULTS.find(v => v.id === event.vaultId);
    if (!descriptor) {
      return;
    }
    this.updateState(descriptor.id, { isLocked: true, entries: [] });
    await this.showToast(
      `${descriptor.label} vault locked`,
      'lock-closed-outline',
    );
  }

  private async handleUnlock(event: UnlockEvent): Promise<void> {
    const descriptor = VAULTS.find(v => v.id === event.vaultId);
    if (!descriptor) {
      return;
    }
    const entries = await this.fetchEntries(descriptor.id);
    this.updateState(descriptor.id, { isLocked: false, entries });
    await this.showToast(
      `${descriptor.label} vault unlocked`,
      'lock-open-outline',
    );
  }

  private async refreshEntries(vaultId: string): Promise<void> {
    const entries = await this.fetchEntries(vaultId);
    this.updateState(vaultId, { entries });
  }

  private async showError(message: string): Promise<void> {
    const alert = await this.alertController.create({
      header: 'Error',
      message,
      buttons: ['OK'],
    });
    await alert.present();
  }

  private async showToast(message: string, icon: string): Promise<void> {
    const toast = await this.toastController.create({
      message,
      icon,
      duration: 2000,
      position: 'bottom',
    });
    await toast.present();
  }

  private updateState(vaultId: string, patch: Partial<VaultState>): void {
    this.states.update(current => ({
      ...current,
      [vaultId]: { ...current[vaultId], ...patch },
    }));
  }
}
