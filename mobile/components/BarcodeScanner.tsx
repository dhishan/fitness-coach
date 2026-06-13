/**
 * BarcodeScanner — self-contained Modal that opens the camera, scans EAN/UPC barcodes,
 * debounces to one event per scan, and fires onCode(code) to the caller.
 *
 * Requires a native dev build (expo-camera is a native module).
 * Permission denied shows an explainer + "Open Settings" button.
 */

import React, { useRef, useState } from 'react'
import {
  Alert,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import type { BarcodeType } from 'expo-camera'
import { colors, radius, spacing, card } from '../src/theme'

const BARCODE_TYPES: BarcodeType[] = ['ean13', 'ean8', 'upc_a', 'upc_e']

interface Props {
  visible: boolean
  onCode: (code: string) => void
  onCancel: () => void
}

export default function BarcodeScanner({ visible, onCode, onCancel }: Props) {
  const [permission, requestPermission] = useCameraPermissions()
  const lastScanned = useRef<string | null>(null)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [requested, setRequested] = useState(false)

  const handleBarcode = ({ data }: { type: string; data: string }) => {
    if (!data) return
    // Debounce: only fire once per scan session; reset after 3s
    if (lastScanned.current === data) return
    lastScanned.current = data
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => {
      lastScanned.current = null
    }, 3000)
    onCode(data)
  }

  const handleRequestPermission = async () => {
    setRequested(true)
    const result = await requestPermission()
    if (!result.granted && !result.canAskAgain) {
      Alert.alert(
        'Camera permission required',
        'Open Settings and allow camera access to scan barcodes.',
        [
          { text: 'Open Settings', onPress: () => Linking.openURL('app-settings:') },
          { text: 'Cancel', style: 'cancel' },
        ],
      )
    }
  }

  const renderContent = () => {
    // Still loading permissions
    if (!permission) {
      return (
        <View style={s.center}>
          <Text style={s.label}>Checking camera permission...</Text>
        </View>
      )
    }

    // Permission denied and cannot ask again
    if (!permission.granted && !permission.canAskAgain && requested) {
      return (
        <View style={s.center}>
          <Text style={s.label}>Camera access is required to scan barcodes.</Text>
          <Pressable style={s.btn} onPress={() => Linking.openURL('app-settings:')}>
            <Text style={s.btnText}>Open Settings</Text>
          </Pressable>
          <Pressable style={[s.btn, s.btnSecondary, { marginTop: spacing.sm }]} onPress={onCancel}>
            <Text style={s.btnSecondaryText}>Cancel</Text>
          </Pressable>
        </View>
      )
    }

    // Not yet granted — show request prompt
    if (!permission.granted) {
      return (
        <View style={s.center}>
          <Text style={s.label}>Camera access is needed to scan barcodes.</Text>
          <Pressable style={s.btn} onPress={() => { void handleRequestPermission() }}>
            <Text style={s.btnText}>Allow camera</Text>
          </Pressable>
          <Pressable style={[s.btn, s.btnSecondary, { marginTop: spacing.sm }]} onPress={onCancel}>
            <Text style={s.btnSecondaryText}>Cancel</Text>
          </Pressable>
        </View>
      )
    }

    // Permission granted — render scanner
    return (
      <View style={s.scannerWrap}>
        <CameraView
          style={s.camera}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: BARCODE_TYPES }}
          onBarcodeScanned={handleBarcode}
        />
        <View style={s.overlay}>
          <View style={s.viewfinder} />
          <Text style={s.hint}>Point the camera at a barcode</Text>
          <Pressable style={[s.btn, s.cancelBtn]} onPress={onCancel}>
            <Text style={s.btnText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    )
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <View style={s.root}>
        {renderContent()}
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.base,
    backgroundColor: colors.bg,
  },
  label: { fontSize: 15, color: colors.text, textAlign: 'center', marginBottom: spacing.md },
  btn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.base,
    paddingVertical: 12,
    borderRadius: radius.md,
    alignItems: 'center',
    minWidth: 180,
  },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  btnSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnSecondaryText: { color: colors.gray600, fontSize: 14, fontWeight: '500' },

  // Scanner layout
  scannerWrap: { flex: 1 },
  camera: { flex: 1 },
  overlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  viewfinder: {
    width: 240,
    height: 160,
    borderWidth: 2,
    borderColor: '#fff',
    borderRadius: radius.md,
    backgroundColor: 'transparent',
  },
  hint: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  cancelBtn: {
    marginTop: spacing.md,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
})
