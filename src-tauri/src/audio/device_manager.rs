#[cfg(windows)]
use wasapi::{DeviceCollection, Direction};

#[derive(Debug, Clone, serde::Serialize)]
pub struct AudioDeviceInfo {
    pub id: String,
    pub name: String,
    pub is_default: bool,
    pub direction: String,
}

/// Enumerates Windows audio endpoints (render devices for system-audio loopback,
/// capture devices for microphone input) so Settings can show device pickers.
pub struct AudioDeviceManager;

#[cfg(windows)]
impl AudioDeviceManager {
    pub fn list_output_devices() -> Result<Vec<AudioDeviceInfo>, String> {
        Self::list_devices(Direction::Render)
    }

    pub fn list_input_devices() -> Result<Vec<AudioDeviceInfo>, String> {
        Self::list_devices(Direction::Capture)
    }

    fn list_devices(direction: Direction) -> Result<Vec<AudioDeviceInfo>, String> {
        wasapi::initialize_mta().ok().map_err(|e| e.to_string())?;

        let enumerator = wasapi::DeviceEnumerator::new().map_err(|e| e.to_string())?;
        let default = enumerator
            .get_default_device(&direction)
            .ok()
            .and_then(|d| d.get_id().ok());

        let collection: DeviceCollection = enumerator
            .get_device_collection(&direction)
            .map_err(|e| e.to_string())?;
        let count = collection.get_nbr_devices().map_err(|e| e.to_string())?;

        let mut devices = Vec::with_capacity(count as usize);
        for i in 0..count {
            let device = collection
                .get_device_at_index(i)
                .map_err(|e| e.to_string())?;
            let id = device.get_id().map_err(|e| e.to_string())?;
            let name = device.get_friendlyname().unwrap_or_else(|_| id.clone());
            let is_default = default.as_deref() == Some(id.as_str());
            devices.push(AudioDeviceInfo {
                id,
                name,
                is_default,
                direction: match direction {
                    Direction::Render => "output".to_string(),
                    Direction::Capture => "input".to_string(),
                },
            });
        }
        Ok(devices)
    }
}

/// Core Audio devices through cpal — same shape as the Windows listing.
#[cfg(target_os = "macos")]
impl AudioDeviceManager {
    pub fn list_output_devices() -> Result<Vec<AudioDeviceInfo>, String> {
        Self::list_devices(true)
    }

    pub fn list_input_devices() -> Result<Vec<AudioDeviceInfo>, String> {
        Self::list_devices(false)
    }

    fn list_devices(output: bool) -> Result<Vec<AudioDeviceInfo>, String> {
        use cpal::traits::{DeviceTrait, HostTrait};

        let host = cpal::default_host();
        let default = if output { host.default_output_device() } else { host.default_input_device() }
            .and_then(|d| d.id().ok())
            .map(|id| id.to_string());
        let devices: Vec<cpal::Device> = if output {
            host.output_devices().map_err(|e| e.to_string())?.collect()
        } else {
            host.input_devices().map_err(|e| e.to_string())?.collect()
        };

        Ok(devices
            .into_iter()
            .filter_map(|device| {
                let id = device.id().ok()?.to_string();
                let name = device.description().map(|d| d.name().to_string()).unwrap_or_else(|_| id.clone());
                Some(AudioDeviceInfo {
                    is_default: default.as_deref() == Some(id.as_str()),
                    id,
                    name,
                    direction: if output { "output" } else { "input" }.to_string(),
                })
            })
            .collect())
    }
}
