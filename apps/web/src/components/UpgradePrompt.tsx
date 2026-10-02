/**
 * The one upgrade prompt: a Solo household tried to add somebody. Mounted once
 * beside the Toaster so it sits inside the phone frame; raised by the request
 * helper when the server says the add needs the Household plan.
 */
import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { Sheet } from './Sheet';
import { Button } from './ui';
import { showToast } from './Toast';
import { onUpgradePrompt } from '../upgradePrompt';
import { type } from '../theme';

export function UpgradePrompt() {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => onUpgradePrompt(setMessage), []);
  if (!message) return null;
  const close = () => setMessage(null);
  return (
    <Sheet title="Planning for more than you?" onCancel={close} cancelLabel="Not now" onClose={close}>
      <Text style={type.body}>{message}</Text>
      <Text style={[type.body, { marginTop: 8 }]}>The Household plan covers up to 6 people, each with their own tastes and allergies.</Text>
      <Button label="Switch to Household" onPress={() => { close(); showToast('Plan and billing is coming soon'); }} style={{ marginTop: 14 }} />
    </Sheet>
  );
}
