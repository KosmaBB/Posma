import os
import sys
import subprocess
import ctypes
import shutil
import logging
import platform
import heapq
from pathlib import Path
from collections import deque
import time
import configparser
import json

try:
    import psutil
except ImportError:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "psutil"])
    import psutil

try:
    import winreg
except ImportError:
    winreg = None

class SystemBackend:
    def __init__(self):
        self.logger = logging.getLogger(__name__)
        logging.basicConfig(level=logging.INFO)
        self.log_file_path = Path.home() / ".system_care_resource_log.json"
        self._initialize_log_file()

    def _initialize_log_file(self):
        """Initializes the JSON log file if it doesn't exist or is malformed."""
        if not self.log_file_path.exists() or self.log_file_path.stat().st_size == 0:
            with open(self.log_file_path, 'w') as f:
                json.dump([], f)  # Initialize with an empty list
        else:
            # Try to load to check if it's valid JSON
            try:
                with open(self.log_file_path, 'r') as f:
                    json.load(f)
            except json.JSONDecodeError:
                self.logger.warning(f"Malformed JSON log file found at {self.log_file_path}. Re-initializing.")
                with open(self.log_file_path, 'w') as f:
                    json.dump([], f)

    def log_resource_usage(self, cpu_percent, ram_percent, disk_percent, top_processes_data):
        """Logs current resource usage and top processes to a JSON file."""
        timestamp = int(time.time())
        log_entry = {
            "timestamp": timestamp,
            "cpu": cpu_percent,
            "ram": ram_percent,
            "disk": disk_percent,
            "top_processes": top_processes_data
        }
        try:
            # Read existing data, append new entry, and write back
            with open(self.log_file_path, 'r+') as f:
                f.seek(0)
                try:
                    data = json.load(f)
                except json.JSONDecodeError:
                    data = []  # Handle empty or malformed file gracefully
                
                data.append(log_entry)
                
                # Keep only the last 7 days of data (approx. 7 * 24 * 60 * 6 = 60480 entries)
                # This is a simple pruning, could be more sophisticated
                max_entries = 7 * 24 * 60 * 6  # 7 days * 24 hours * 60 minutes * 6 samples/min (10s interval)
                if len(data) > max_entries:
                    data = data[-max_entries:]

                f.seek(0)
                f.truncate()
                json.dump(data, f, indent=2)
            self.logger.debug(f"Logged resource usage at {timestamp}")
        except Exception as e:
            self.logger.error(f"Failed to log resource usage: {e}")

    def get_historical_data(self, start_timestamp=None, end_timestamp=None):
        """Retrieves historical resource data within a given timestamp range."""
        data = []
        try:
            with open(self.log_file_path, 'r') as f:
                all_entries = json.load(f)
            
            for entry in all_entries:
                ts = entry.get("timestamp")
                if ts is None:
                    continue
                
                if (start_timestamp is None or ts >= start_timestamp) and \
                   (end_timestamp is None or ts <= end_timestamp):
                    data.append(entry)
        except FileNotFoundError:
            self.logger.warning("Resource log file not found.")
        except json.JSONDecodeError as e:
            self.logger.error(f"Error decoding resource log JSON: {e}. Attempting to re-initialize.")
            self._initialize_log_file()  # Re-initialize if corrupted
        return data

    def get_platform(self):
        if sys.platform == "win32":
            return "win"
        elif sys.platform == "darwin":
            return "mac"
        elif sys.platform.startswith("linux"):
            return "linux"
        return "unknown"

    def is_admin(self):
        platform_name = self.get_platform()
        try:
            if platform_name == "win":
                return ctypes.windll.shell32.IsUserAnAdmin() != 0
            elif platform_name in ["mac", "linux"]:
                return os.geteuid() == 0
        except Exception as e:
            self.logger.error(f"Error checking admin privileges: {e}")
        return False

    def run_command(self, command, shell=False, live_output_callback=None):
        self.logger.info(f"Executing: {' '.join(command) if isinstance(command, list) else command}")
        try:
            process = subprocess.Popen(
                command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, shell=shell,
                encoding='utf-8', errors='ignore', bufsize=1 # Line-buffered output
            )
            stdout_lines = []
            stderr_lines = []

            # Read stdout in real-time
            for line in iter(process.stdout.readline, ''):
                if live_output_callback:
                    live_output_callback(line.strip(), "stdout")
                stdout_lines.append(line)
            
            # Read stderr in real-time
            for line in iter(process.stderr.readline, ''):
                if live_output_callback:
                    live_output_callback(line.strip(), "stderr")
                stderr_lines.append(line)

            process.wait() # Wait for the process to terminate

            full_stdout = "".join(stdout_lines)
            full_stderr = "".join(stderr_lines)

            if full_stdout:
                self.logger.info(full_stdout.strip())
            if full_stderr:
                self.logger.warning(full_stderr.strip())
            
            return full_stdout
        except Exception as e:
            self.logger.error(f"Failed to execute command: {e}")
            if live_output_callback:
                live_output_callback(f"Error: {e}", "error")
            return None

    def run_diagnostics(self, live_output_callback=None):
        platform_name = self.get_platform()
        if platform_name == "win":
            self.run_command(["sfc", "/scannow"], live_output_callback=live_output_callback)
        elif platform_name == "mac":
            self.run_command(["sudo", "fsck", "-fy"], live_output_callback=live_output_callback)
        elif platform_name == "linux":
            self.run_command(["sudo", "fsck", "-f", "/"], live_output_callback=live_output_callback)

    def clean_temp_folders(self, live_output_callback=None):
        temp_paths = []
        
        if sys.platform == "win32":
            temp_paths = [
                Path(os.environ.get("TEMP", "")),
                Path(os.environ.get("TMP", "")),
                Path(os.environ.get("LOCALAPPDATA", "")) / "Temp"
            ]
        elif sys.platform == "darwin":
            temp_paths = [
                Path("/tmp"),
                Path.home() / "Library/Caches"
            ]
        else:  # Linux
            temp_paths = [
                Path("/tmp"),
                Path("/var/tmp"),
                Path.home() / ".cache"
            ]
        
        for temp_path in temp_paths:
            if temp_path and temp_path.exists() and temp_path.is_dir():
                if live_output_callback:
                    live_output_callback(f"Cleaning: {temp_path}", "info")
                try:
                    for item in temp_path.iterdir():
                        if item.is_file():
                            item.unlink()
                            if live_output_callback:
                                live_output_callback(f"  Deleted file: {item.name}", "stdout")
                        elif item.is_dir():
                            shutil.rmtree(item, ignore_errors=True)
                            if live_output_callback:
                                live_output_callback(f"  Deleted folder: {item.name}", "stdout")
                except Exception as e:
                    if live_output_callback:
                        live_output_callback(f"Could not clean {temp_path}: {e}", "error")
                    self.logger.warning(f"Could not clean {temp_path}: {e}")

    def cleanup_disk_space(self, live_output_callback=None):
        platform_name = self.get_platform()
        if platform_name == "win":
            self.run_command(["cleanmgr", "/sagerun:1"], shell=True, live_output_callback=live_output_callback)
        elif platform_name == "mac":
            self.run_command(["sudo", "rm", "-rf", "/System/Library/Caches/*"], live_output_callback=live_output_callback)
        elif platform_name == "linux":
            self.run_command(["sudo", "apt-get", "clean"], live_output_callback=live_output_callback)

    def empty_trash(self, live_output_callback=None):
        platform_name = self.get_platform()
        if platform_name == "win":
            self.run_command(["powershell.exe", "-Command", "Clear-RecycleBin -Force"], live_output_callback=live_output_callback)
        elif platform_name == "mac":
            self.run_command(["rm", "-rf", str(Path.home() / ".Trash/*")], live_output_callback=live_output_callback)
        elif platform_name == "linux":
            trash_path = Path.home() / ".local/share/Trash"
            if trash_path.exists():
                shutil.rmtree(trash_path, ignore_errors=True)
                trash_path.mkdir(parents=True, exist_ok=True)
                if live_output_callback:
                    live_output_callback(f"Emptied trash at {trash_path}", "stdout")
            else:
                if live_output_callback:
                    live_output_callback(f"Trash directory not found at {trash_path}", "info")

    def optimize_storage(self, live_output_callback=None):
        platform_name = self.get_platform()
        if platform_name == "win":
            self.run_command(["defrag", "C:", "/O"], live_output_callback=live_output_callback)
        else:
            if live_output_callback:
                live_output_callback(f"Disk defragmentation/optimization is not typically needed on {platform_name}.", "info")

    def run_system_updates(self, live_output_callback=None):
        platform_name = self.get_platform()
        if platform_name == "win":
            self.run_command(["winget", "upgrade", "--all", "--silent"], live_output_callback=live_output_callback)
        elif platform_name == "mac":
            self.run_command(["softwareupdate", "-i", "-a"], live_output_callback=live_output_callback)
        elif platform_name == "linux":
            self.run_command(["sudo", "apt", "update", "&&", "sudo", "apt", "upgrade", "-y"], shell=True, live_output_callback=live_output_callback)

    def find_large_files(self, path_to_scan, num_files, update_callback):
        largest_files = []
        try:
            for dirpath, _, filenames in os.walk(path_to_scan):
                for filename in filenames:
                    try:
                        file_path = Path(dirpath) / filename
                        file_size = file_path.stat().st_size
                        
                        if len(largest_files) < num_files:
                            heapq.heappush(largest_files, (file_size, file_path))
                        else:
                            heapq.heappushpop(largest_files, (file_size, file_path))
                    except (OSError, FileNotFoundError):
                        continue
        except Exception as e:
            self.logger.error(f"Error during file scanning: {e}")
        
        # Sort by size (largest first)
        largest_files.sort(reverse=True)
        update_callback(largest_files)

    def open_file_location(self, file_path):
        dir_path = os.path.dirname(file_path)
        try:
            if sys.platform == "win32":
                os.startfile(dir_path)
            elif sys.platform == "darwin":
                subprocess.run(["open", "-R", file_path])
            else:
                subprocess.run(["xdg-open", dir_path])
        except Exception as e:
            self.logger.error(f"Cannot open location {dir_path}: {e}")

    def get_startup_programs(self):
        self.logger.info("Getting startup programs list...")
        platform_name = self.get_platform()
        programs = []
        
        if platform_name == "win" and winreg:
            programs.extend(self._get_win_startup_programs())
        elif platform_name == "mac":
            programs.extend(self._get_mac_startup_programs())
        elif platform_name == "linux":
            programs.extend(self._get_linux_startup_programs())
        
        return programs

    def _get_win_startup_programs(self):
        programs = []
        startup_keys = [
            (winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Run"),
            (winreg.HKEY_LOCAL_MACHINE, r"Software\Microsoft\Windows\CurrentVersion\Run")
        ]
        
        for hkey, key_path in startup_keys:
            try:
                with winreg.OpenKey(hkey, key_path, 0, winreg.KEY_READ) as key:
                    i = 0
                    while True:
                        try:
                            name, value, _ = winreg.EnumValue(key, i)
                            programs.append({
                                "name": name,
                                "path": value,
                                "enabled": True, # Windows registry entries are typically "enabled" if present
                                "type": "registry",
                                "key_path": f"{hkey}\\{key_path}"
                            })
                            i += 1
                        except OSError:
                            break
            except FileNotFoundError:
                pass
        
        # Also check Startup folder
        startup_folder = Path(os.environ.get("APPDATA")) / "Microsoft\\Windows\\Start Menu\\Programs\\Startup"
        if startup_folder.exists():
            for item in startup_folder.iterdir():
                if item.is_file() and item.suffix.lower() in ['.lnk', '.url', '.bat', '.exe']:
                    programs.append({
                        "name": item.stem,
                        "path": str(item),
                        "enabled": True,
                        "type": "folder"
                    })
        return programs

    def _get_mac_startup_programs(self):
        programs = []
        launch_paths = [
            Path.home() / "Library/LaunchAgents",
            Path("/Library/LaunchAgents"),
            Path("/Library/LaunchDaemons")
        ]
        
        for path in launch_paths:
            if not path.is_dir():
                continue
            
            for plist_file in path.glob("*.plist"):
                try:
                    # Simple plist parsing (you might want to use plistlib for full parsing)
                    # For now, assume enabled if file exists
                    programs.append({
                        "name": plist_file.stem,
                        "path": str(plist_file),
                        "enabled": True,
                        "type": "plist"
                    })
                except Exception as e:
                    self.logger.warning(f"Cannot read file {plist_file}: {e}")
        
        return programs

    def _get_linux_startup_programs(self):
        programs = []
        autostart_paths = [
            Path.home() / ".config/autostart",
            Path("/etc/xdg/autostart")
        ]
        
        for path in autostart_paths:
            if not path.is_dir():
                continue
            for desktop_file in path.glob("*.desktop"):
                try:
                    config = configparser.ConfigParser()
                    config.read(desktop_file)
                    
                    if config.has_section("Desktop Entry") and "Name" in config["Desktop Entry"]:
                        programs.append({
                            "name": config["Desktop Entry"]["Name"],
                            "path": str(desktop_file),
                            "enabled": not config["Desktop Entry"].getboolean("Hidden", False),
                            "type": "desktop"
                        })
                except Exception as e:
                    self.logger.warning(f"Cannot read file {desktop_file}: {e}")
        
        return programs

    def add_startup_program(self, name, path, live_output_callback=None):
        platform_name = self.get_platform()
        try:
            if platform_name == "win":
                # Add to HKEY_CURRENT_USER Run key
                key_path = r"Software\Microsoft\Windows\CurrentVersion\Run"
                with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path, 0, winreg.KEY_SET_VALUE) as key:
                    winreg.SetValueEx(key, name, 0, winreg.REG_SZ, path)
                if live_output_callback:
                    live_output_callback(f"Added '{name}' to Windows Registry startup.", "stdout")
            elif platform_name == "linux":
                # Create a .desktop file
                autostart_dir = Path.home() / ".config/autostart"
                autostart_dir.mkdir(parents=True, exist_ok=True)
                desktop_file_path = autostart_dir / f"{name}.desktop"
                
                content = f"""[Desktop Entry]
                    Type=Application
                    Exec={path}
                    Hidden=false
                    NoDisplay=false
                    X-GNOME-Autostart-enabled=true
                    Name={name}
                    Comment=Added by System Care Professional
                    """
                with open(desktop_file_path, "w") as f:
                    f.write(content)
                desktop_file_path.chmod(0o755) # Make it executable
                if live_output_callback:
                    live_output_callback(f"Created '{desktop_file_path}' for Linux startup.", "stdout")
            else:
                if live_output_callback:
                    live_output_callback(f"Adding startup programs is not yet supported for {platform_name}.", "error")
                return False
            return True
        except Exception as e:
            self.logger.error(f"Failed to add startup program: {e}")
            if live_output_callback:
                live_output_callback(f"Error adding startup program: {e}", "error")
            return False

    def remove_startup_program(self, program_data, live_output_callback=None):
        platform_name = self.get_platform()
        try:
            if platform_name == "win":
                if program_data.get("type") == "registry":
                    key_path_full = program_data.get("key_path")
                    name = program_data.get("name")
                    if key_path_full and name:
                        hkey_str, key_path = key_path_full.split("\\", 1)
                        hkey = winreg.HKEY_CURRENT_USER if "HKEY_CURRENT_USER" in hkey_str else winreg.HKEY_LOCAL_MACHINE
                        with winreg.OpenKey(hkey, key_path, 0, winreg.KEY_SET_VALUE) as key:
                            winreg.DeleteValue(key, name)
                        if live_output_callback:
                            live_output_callback(f"Removed '{name}' from Windows Registry startup.", "stdout")
                elif program_data.get("type") == "folder":
                    file_path = Path(program_data.get("path"))
                    if file_path.exists():
                        file_path.unlink()
                        if live_output_callback:
                            live_output_callback(f"Removed '{file_path.name}' from Windows Startup folder.", "stdout")
            elif platform_name == "linux":
                file_path = Path(program_data.get("path"))
                if file_path.exists():
                    file_path.unlink()
                    if live_output_callback:
                        live_output_callback(f"Removed '{file_path.name}' from Linux autostart.", "stdout")
            else:
                if live_output_callback:
                    live_output_callback(f"Removing startup programs is not yet supported for {platform_name}.", "error")
                return False
            return True
        except Exception as e:
            self.logger.error(f"Failed to remove startup program: {e}")
            if live_output_callback:
                live_output_callback(f"Error removing startup program: {e}", "error")
            return False

    def toggle_startup_program(self, program_data, enable, live_output_callback=None):
        platform_name = self.get_platform()
        try:
            if platform_name == "linux" and program_data.get("type") == "desktop":
                desktop_file_path = Path(program_data.get("path"))
                if desktop_file_path.exists():
                    config = configparser.ConfigParser()
                    config.read(desktop_file_path)
                    
                    if not config.has_section("Desktop Entry"):
                        config.add_section("Desktop Entry")
                    
                    config["Desktop Entry"]["Hidden"] = "true" if not enable else "false"
                    config["Desktop Entry"]["X-GNOME-Autostart-enabled"] = "true" if enable else "false"
                    
                    with open(desktop_file_path, "w") as f:
                        config.write(f)
                    
                    if live_output_callback:
                        status = "enabled" if enable else "disabled"
                        live_output_callback(f"Program '{program_data.get('name')}' {status} in Linux autostart.", "stdout")
                    return True
            else:
                if live_output_callback:
                    live_output_callback(f"Toggling startup programs is not yet supported for {platform_name} or this type.", "error")
                return False
            return False # Default to false if not handled
        except Exception as e:
            self.logger.error(f"Failed to toggle startup program: {e}")
            if live_output_callback:
                live_output_callback(f"Error toggling startup program: {e}", "error")
            return False

    def export_system_info(self, save_path):
        self.logger.info(f"Exporting system information to: {save_path}")
        try:
            with open(save_path, 'w', encoding='utf-8') as f:
                f.write("=== System Care Suite: System Report ===\n")
                f.write(f"Generated: {time.strftime('%Y-%m-%d %H:%M:%S')}\n\n")
                
                # Operating System
                f.write("=== Operating System ===\n")
                f.write(f"System: {platform.system()} {platform.release()}\n")
                f.write(f"Architecture: {platform.machine()}\n")
                f.write(f"Version: {platform.version()}\n\n")
                
                # Hardware
                f.write("=== Hardware ===\n")
                f.write(f"Processor: {platform.processor()}\n")
                f.write(f"Physical cores: {psutil.cpu_count(logical=False)}\n")
                f.write(f"Logical cores: {psutil.cpu_count(logical=True)}\n")
                
                mem = psutil.virtual_memory()
                gb = 1024**3
                f.write(f"RAM: {mem.total / gb:.2f} GB\n\n")
                
                # Disk information
                f.write("=== Storage ===\n")
                try:
                    disk_path = Path.home().anchor
                    usage = psutil.disk_usage(disk_path)
                    f.write(f"Main drive: {disk_path}\n")
                    f.write(f"  Total size: {usage.total / gb:.2f} GB\n")
                    f.write(f"  Used space: {usage.used / gb:.2f} GB\n")
                    f.write(f"  Free space: {usage.free / gb:.2f} GB\n")
                    f.write(f"  Usage: {usage.percent}%\n\n")
                except Exception as e:
                    f.write(f"Could not read disk information: {e}\n\n")
                
            self.logger.info("Successfully exported system information.")
        except Exception as e:
            self.logger.error(f"Failed to export information: {e}")

    def shutdown_system(self):
        platform_name = self.get_platform()
        if platform_name == "win":
            self.run_command(["shutdown", "/s", "/t", "15"])
        elif platform_name == "mac":
            self.run_command(["sudo", "shutdown", "-h", "+1"])
        elif platform_name == "linux":
            self.run_command(["sudo", "shutdown", "-h", "+1"])

