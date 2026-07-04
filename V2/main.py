import sys
import os
import json
import threading
import time
from pathlib import Path
import platform
import webbrowser
from PyQt6.QtWidgets import *
from PyQt6.QtCore import *
from PyQt6.QtGui import *
from PyQt6.QtCharts import *

try:
    import psutil
except ImportError:
    print("Installing psutil...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "psutil"])
    import psutil

from backend import SystemBackend
from widgets import ProfessionalCard, ModernButton, SystemChart, ProgressWidget, StatusIndicator, TerminalWidget, AutostartItemWidget
from translations import get_translations

class SystemCareApp(QMainWindow):
    def __init__(self):
        super().__init__()
        self.translations_data = get_translations()
        self.current_lang = "pl"
        self.current_theme_key = "professional"
        self.monitoring_active = True
        self.backend = SystemBackend()

        self.setWindowTitle(self.tr("app_name"))
        self.setMinimumSize(1500, 950)
        self.resize(1700, 1100)

        self.setWindowFlags(Qt.WindowType.Window | Qt.WindowType.WindowMinMaxButtonsHint | Qt.WindowType.WindowCloseButtonHint)

        self.setup_ui()
        self.load_config()
        self.apply_theme(self.current_theme_key)
        self.update_ui_texts()

        self.start_monitoring()
        self.start_resource_logging()
        self.refresh_autostart_list()

    def tr(self, key):
        return self.translations_data.get(key, {}).get(self.current_lang, key)

    def apply_theme(self, theme_key):
        self.current_theme_key = theme_key
        # For brevity, styles are kept here. In a large project, load these from .qss files.
        if theme_key == "professional":
            style = """
            QMainWindow {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:1, stop:0 #0a0a0f, stop:0.3 #1a1a2e, stop:0.7 #16213e, stop:1 #0f172a);
                color: #e2e8f0;
            }
            QWidget { color: #e2e8f0; font-family: 'Segoe UI', 'Arial', sans-serif; }
            QWidget#sidebar {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 #1e1b4b, stop:0.5 #312e81, stop:1 #1e3a8a);
                border-right: 2px solid #4338ca; border-radius: 0px;
            }
            QPushButton#nav_button {
                background: rgba(99, 102, 241, 0.1); border: 1px solid rgba(99, 102, 241, 0.3); border-radius: 8px;
                padding: 16px 20px; color: #cbd5e1; font-size: 14px; font-weight: 600; text-align: left; margin: 4px 8px;
            }
            QPushButton#nav_button:hover { background: rgba(99, 102, 241, 0.2); border-color: #6366f1; color: #f1f5f9; }
            QPushButton#nav_button:pressed { background: rgba(99, 102, 241, 0.3); }
            QPushButton#nav_button[selected="true"] {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 #6366f1, stop:1 #8b5cf6);
                border-color: #a855f7; color: white; font-weight: bold;
            }
            QLabel#main_title { color: #f8fafc; font-size: 32px; font-weight: bold; margin: 20px 0px 10px 0px; }
            QLabel#subtitle { color: #94a3b8; font-size: 16px; margin: 0px 0px 30px 0px; }
            QLabel#sidebar_title { color: #f1f5f9; font-size: 24px; font-weight: bold; margin: 20px 0px 5px 0px; }
            QLabel#sidebar_subtitle { color: #a5b4fc; font-size: 12px; margin: 0px 0px 30px 0px; }
            QWidget#content_area { background: rgba(15, 23, 42, 0.3); border-radius: 12px; margin: 10px; }
            QScrollBar:vertical { background: rgba(30, 41, 59, 0.5); width: 12px; border-radius: 6px; }
            QScrollBar::handle:vertical { background: #6366f1; border-radius: 6px; min-height: 20px; }
            QScrollBar::handle:vertical:hover { background: #8b5cf6; }
            """
        elif theme_key == "dark_blue":
            style = """
            QMainWindow {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:1, stop:0 #0D1B2A, stop:0.3 #1B263B, stop:0.7 #2E4A62, stop:1 #415A77);
                color: #E0FBFC;
            }
            QWidget { color: #E0FBFC; font-family: 'Segoe UI', 'Arial', sans-serif; }
            QWidget#sidebar {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 #0D1B2A, stop:0.5 #1B263B, stop:1 #2E4A62);
                border-right: 2px solid #415A77; border-radius: 0px;
            }
            QPushButton#nav_button {
                background: rgba(65, 90, 119, 0.1); border: 1px solid rgba(65, 90, 119, 0.3); border-radius: 8px;
                padding: 16px 20px; color: #A2D2FF; font-size: 14px; font-weight: 600; text-align: left; margin: 4px 8px;
            }
            QPushButton#nav_button:hover { background: rgba(65, 90, 119, 0.2); border-color: #A2D2FF; color: #E0FBFC; }
            QPushButton#nav_button:pressed { background: rgba(65, 90, 119, 0.3); }
            QPushButton#nav_button[selected="true"] {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 #A2D2FF, stop:1 #BDE0FE);
                border-color: #BDE0FE; color: #0D1B2A; font-weight: bold;
            }
            QLabel#main_title { color: #E0FBFC; font-size: 32px; font-weight: bold; margin: 20px 0px 10px 0px; }
            QLabel#subtitle { color: #A2D2FF; font-size: 16px; margin: 0px 0px 30px 0px; }
            QLabel#sidebar_title { color: #E0FBFC; font-size: 24px; font-weight: bold; margin: 20px 0px 5px 0px; }
            QLabel#sidebar_subtitle { color: #A2D2FF; font-size: 12px; margin: 0px 0px 30px 0px; }
            QWidget#content_area { background: rgba(13, 27, 42, 0.3); border-radius: 12px; margin: 10px; }
            QScrollBar:vertical { background: rgba(46, 74, 98, 0.5); width: 12px; border-radius: 6px; }
            QScrollBar::handle:vertical { background: #A2D2FF; border-radius: 6px; min-height: 20px; }
            QScrollBar::handle:vertical:hover { background: #BDE0FE; }
            """
        else:
            return

        self.setStyleSheet(style)
        for widget in self.findChildren(QWidget):
            widget.style().unpolish(widget)
            widget.style().polish(widget)

    def setup_ui(self):
        central_widget = QWidget()
        self.setCentralWidget(central_widget)
        main_layout = QHBoxLayout(central_widget)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(0)

        self.setup_sidebar(main_layout)

        content_container = QWidget()
        content_container.setObjectName("content_area")
        content_layout = QVBoxLayout(content_container)
        content_layout.setContentsMargins(30, 30, 30, 30)
        
        self.content_stack = QStackedWidget()
        content_layout.addWidget(self.content_stack)
        main_layout.addWidget(content_container, 1)

        self.create_dashboard_page()
        self.create_maintenance_page()
        self.create_file_finder_page()
        self.create_autostart_page()
        self.create_settings_page()

        self.show_page(0)

    def setup_sidebar(self, main_layout):
        sidebar = QWidget()
        sidebar.setObjectName("sidebar")
        sidebar.setFixedWidth(320)
        sidebar_layout = QVBoxLayout(sidebar)
        sidebar_layout.setContentsMargins(25, 40, 25, 30)
        sidebar_layout.setSpacing(15)

        self.sidebar_title = QLabel()
        self.sidebar_title.setObjectName("sidebar_title")
        self.sidebar_title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        sidebar_layout.addWidget(self.sidebar_title)

        self.sidebar_subtitle = QLabel()
        self.sidebar_subtitle.setObjectName("sidebar_subtitle")
        self.sidebar_subtitle.setAlignment(Qt.AlignmentFlag.AlignCenter)
        sidebar_layout.addWidget(self.sidebar_subtitle)

        self.status_indicator = StatusIndicator()
        sidebar_layout.addWidget(self.status_indicator)
        sidebar_layout.addSpacing(20)

        self.nav_buttons = []
        nav_items = [
            ("dashboard", "🏠", "Przegląd systemu"),
            ("maintenance", "🔧", "Zadania utrzymania"),
            ("file_finder", "📁", "Wyszukiwarka dużych plików"),
            ("autostart", "⚡", "Programy startowe"),
            ("settings", "⚙️", "Konfiguracja aplikacji")
        ]
        for i, (key, icon, desc) in enumerate(nav_items):
            btn = QPushButton(f"{icon}  {self.tr(key)}")
            btn.setObjectName("nav_button")
            btn.setToolTip(desc)
            btn.clicked.connect(lambda checked, idx=i: self.show_page(idx))
            btn.setProperty("selected", "false")
            self.nav_buttons.append(btn)
            sidebar_layout.addWidget(btn)

        sidebar_layout.addStretch()

        self.sys_info_card = ProfessionalCard("", compact=True)
        sys_info_layout = QVBoxLayout(self.sys_info_card.content_widget)
        self.sys_label = QLabel(f"{platform.system()} {platform.release()}")
        self.sys_label.setStyleSheet("color: #94a3b8; font-size: 11px;")
        sys_info_layout.addWidget(self.sys_label)
        sidebar_layout.addWidget(self.sys_info_card)

        author_label = QLabel("© 2025 Kosma Brzeżawski")
        author_label.setStyleSheet("color: #64748b; font-size: 10px; text-align: center; margin-top: 10px;")
        author_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        author_label.mousePressEvent = lambda e: webbrowser.open("https://github.com/kosmabb")
        author_label.setCursor(Qt.CursorShape.PointingHandCursor)
        sidebar_layout.addWidget(author_label)

        main_layout.addWidget(sidebar)

    def show_page(self, index):
        for i, btn in enumerate(self.nav_buttons):
            is_selected = "true" if i == index else "false"
            if btn.property("selected") != is_selected:
                btn.setProperty("selected", is_selected)
                btn.style().unpolish(btn)
                btn.style().polish(btn)
        self.content_stack.setCurrentIndex(index)
    
    def create_dashboard_page(self):
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setSpacing(25)

        self.dashboard_header = QLabel()
        self.dashboard_header.setObjectName("main_title")
        layout.addWidget(self.dashboard_header)
        
        self.dashboard_subtitle = QLabel()
        self.dashboard_subtitle.setObjectName("subtitle")
        layout.addWidget(self.dashboard_subtitle)
        
        stats_grid = QGridLayout()
        stats_grid.setSpacing(20)

        self.cpu_card = ProfessionalCard(icon="🖥️")
        cpu_content = QVBoxLayout(self.cpu_card.content_widget)
        self.cpu_label = QLabel("0.0%")
        self.cpu_label.setStyleSheet("font-size: 42px; font-weight: bold; color: #6366f1; margin: 10px 0px;")
        self.cpu_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        cpu_content.addWidget(self.cpu_label)
        self.cpu_chart = SystemChart("#6366f1")
        cpu_content.addWidget(self.cpu_chart)
        stats_grid.addWidget(self.cpu_card, 0, 0)
        
        self.ram_card = ProfessionalCard(icon="💾")
        ram_content = QVBoxLayout(self.ram_card.content_widget)
        self.ram_label = QLabel("0.0%")
        self.ram_label.setStyleSheet("font-size: 42px; font-weight: bold; color: #8b5cf6; margin: 10px 0px;")
        self.ram_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        ram_content.addWidget(self.ram_label)
        self.ram_chart = SystemChart("#8b5cf6")
        ram_content.addWidget(self.ram_chart)
        stats_grid.addWidget(self.ram_card, 0, 1)
        
        self.disk_card = ProfessionalCard(icon="💿")
        disk_content = QVBoxLayout(self.disk_card.content_widget)
        self.disk_progress = QProgressBar()
        self.disk_progress.setStyleSheet("""
            QProgressBar { border: 2px solid #374151; border-radius: 8px; background: #1f2937; height: 24px; text-align: center; color: white; font-weight: bold; }
            QProgressBar::chunk { background: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 #f59e0b, stop:1 #d97706); border-radius: 6px; }
        """)
        disk_content.addWidget(self.disk_progress)
        self.disk_info_label = QLabel()
        self.disk_info_label.setStyleSheet("color: #94a3b8; font-size: 14px; margin-top: 10px;")
        self.disk_info_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        disk_content.addWidget(self.disk_info_label)
        stats_grid.addWidget(self.disk_card, 1, 0, 1, 2)
        
        layout.addLayout(stats_grid)
        
        self.processes_card = ProfessionalCard(icon="⚙️")
        processes_layout = QVBoxLayout(self.processes_card.content_widget)
        self.processes_list = QListWidget()
        self.processes_list.setStyleSheet("""
            QListWidget { background: rgba(30, 41, 59, 0.3); border: 1px solid #374151; border-radius: 8px; color: #e2e8f0; font-family: 'Consolas', 'Monaco', monospace; font-size: 12px; }
            QListWidget::item { padding: 8px; border-bottom: 1px solid rgba(55, 65, 81, 0.5); }
            QListWidget::item:hover { background: rgba(99, 102, 241, 0.1); }
        """)
        processes_layout.addWidget(self.processes_list)
        layout.addWidget(self.processes_card)
        layout.addStretch()
        self.content_stack.addWidget(page)

    def create_maintenance_page(self):
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setSpacing(25)
        
        self.maintenance_header = QLabel()
        self.maintenance_header.setObjectName("main_title")
        layout.addWidget(self.maintenance_header)
        
        self.maintenance_subtitle = QLabel()
        self.maintenance_subtitle.setObjectName("subtitle")
        layout.addWidget(self.maintenance_subtitle)

        main_content_layout = QHBoxLayout()
        main_content_layout.setSpacing(20)
        left_column_layout = QVBoxLayout()
        
        self.tasks_card = ProfessionalCard(icon="📋")
        tasks_layout = QVBoxLayout(self.tasks_card.content_widget)
        tasks_layout.setSpacing(10)
        self.task_checkboxes = {}
        self.task_desc_labels = {}
        tasks_data = [
            ("diagnostics", "diagnostics", "diagnostics_desc", "🔍"),
            ("temp_folders", "temp_files_cleanup", "temp_files_cleanup_desc", "🗑️"),
            ("disk_cleanup", "disk_cleanup", "disk_cleanup_desc", "🧹"),
            ("empty_trash", "empty_trash", "empty_trash_desc", "♻️"),
            ("optimize_storage", "optimize_storage", "optimize_storage_desc", "⚡"),
            ("system_updates", "system_updates", "system_updates_desc", "🔄")
        ]
        checkbox_style = """
            QCheckBox { color: #e2e8f0; font-size: 14px; spacing: 10px; }
            QCheckBox::indicator { width: 20px; height: 20px; border: 2px solid #64748b; border-radius: 4px; background: #1f2937; }
            QCheckBox::indicator:checked { background: #6366f1; border: 2px solid #6366f1; }
        """
        for task_id, title_key, desc_key, icon_char in tasks_data:
            checkbox = QCheckBox(f"{icon_char} {self.tr(title_key)}")
            checkbox.setStyleSheet(checkbox_style)
            self.task_checkboxes[task_id] = checkbox
            tasks_layout.addWidget(checkbox)
            
            desc_label = QLabel(self.tr(desc_key))
            desc_label.setStyleSheet("color: #94a3b8; font-size: 12px; margin-left: 30px;")
            self.task_desc_labels[desc_key] = desc_label
            tasks_layout.addWidget(desc_label)
        
        tasks_layout.addStretch()
        left_column_layout.addWidget(self.tasks_card)

        self.terminal_widget = TerminalWidget(icon="💻")
        left_column_layout.addWidget(self.terminal_widget)
        main_content_layout.addLayout(left_column_layout, 2)

        right_column_layout = QVBoxLayout()
        right_column_layout.setSpacing(20)

        self.presets_card = ProfessionalCard(icon="⚡")
        presets_layout = QVBoxLayout(self.presets_card.content_widget)
        self.full_maintenance_btn = ModernButton(primary=True, large=True)
        self.full_maintenance_btn.clicked.connect(self.select_full_preset)
        presets_layout.addWidget(self.full_maintenance_btn)
        self.disk_only_btn = ModernButton(secondary=True, large=True)
        self.disk_only_btn.clicked.connect(self.select_disk_preset)
        presets_layout.addWidget(self.disk_only_btn)
        right_column_layout.addWidget(self.presets_card)

        self.progress_widget = ProgressWidget()
        right_column_layout.addWidget(self.progress_widget)

        self.control_card = ProfessionalCard(icon="⚙️")
        control_layout = QVBoxLayout(self.control_card.content_widget)
        self.shutdown_checkbox = QCheckBox()
        self.shutdown_checkbox.setStyleSheet(checkbox_style.replace("#6366f1", "#f59e0b"))
        control_layout.addWidget(self.shutdown_checkbox)
        self.start_maintenance_btn = ModernButton(primary=True, large=True)
        self.start_maintenance_btn.clicked.connect(self.start_maintenance)
        control_layout.addWidget(self.start_maintenance_btn)
        right_column_layout.addWidget(self.control_card)
        right_column_layout.addStretch()
        main_content_layout.addLayout(right_column_layout, 1)

        layout.addLayout(main_content_layout)
        layout.addStretch()
        self.content_stack.addWidget(page)

    def create_file_finder_page(self):
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setSpacing(25)

        self.file_finder_header = QLabel()
        self.file_finder_header.setObjectName("main_title")
        layout.addWidget(self.file_finder_header)
        
        self.file_finder_subtitle = QLabel()
        self.file_finder_subtitle.setObjectName("subtitle")
        layout.addWidget(self.file_finder_subtitle)

        self.scan_settings_card = ProfessionalCard(icon="⚙️")
        scan_settings_layout = QVBoxLayout(self.scan_settings_card.content_widget)
        
        folder_select_layout = QHBoxLayout()
        self.folder_path_label = QLabel(str(Path.home()))
        self.folder_path_label.setStyleSheet("color: #e2e8f0; font-size: 14px; padding: 8px; border: 1px solid #374151; border-radius: 6px; background: rgba(30, 41, 59, 0.5);")
        folder_select_layout.addWidget(self.folder_path_label)
        self.select_folder_btn = ModernButton(secondary=True)
        self.select_folder_btn.clicked.connect(self.select_scan_folder)
        folder_select_layout.addWidget(self.select_folder_btn)
        scan_settings_layout.addLayout(folder_select_layout)

        files_count_layout = QHBoxLayout()
        self.files_to_find_label = QLabel()
        self.files_count_label = QLabel("10")
        self.files_count_label.setStyleSheet("color: #e2e8f0; font-size: 14px; font-weight: bold;")
        files_count_layout.addWidget(self.files_to_find_label)
        files_count_layout.addWidget(self.files_count_label)
        self.files_count_slider = QSlider(Qt.Orientation.Horizontal)
        self.files_count_slider.setRange(1, 100)
        self.files_count_slider.setValue(10)
        self.files_count_slider.valueChanged.connect(lambda val: self.files_count_label.setText(str(val)))
        self.files_count_slider.setStyleSheet("""
            QSlider::groove:horizontal { border: 1px solid #374151; height: 8px; background: #1f2937; border-radius: 4px; }
            QSlider::handle:horizontal { background: #6366f1; border: 1px solid #6366f1; width: 18px; margin: -5px 0; border-radius: 9px; }
            QSlider::handle:horizontal:hover { background: #8b5cf6; }
        """)
        files_count_layout.addWidget(self.files_count_slider)
        scan_settings_layout.addLayout(files_count_layout)

        self.start_scan_btn = ModernButton(primary=True, large=True)
        self.start_scan_btn.clicked.connect(self.start_file_scan)
        scan_settings_layout.addWidget(self.start_scan_btn)
        layout.addWidget(self.scan_settings_card)

        self.results_card = ProfessionalCard(icon="📄")
        results_layout = QVBoxLayout(self.results_card.content_widget)
        self.results_list = QListWidget()
        self.results_list.setStyleSheet("""
            QListWidget { background: rgba(30, 41, 59, 0.3); border: 1px solid #374151; border-radius: 8px; color: #e2e8f0; font-family: 'Consolas', 'Monaco', monospace; font-size: 12px; }
            QListWidget::item { padding: 8px; border-bottom: 1px solid rgba(55, 65, 81, 0.5); }
            QListWidget::item:hover { background: rgba(99, 102, 241, 0.1); }
        """)
        self.results_list.itemDoubleClicked.connect(self.open_file_location)
        results_layout.addWidget(self.results_list)
        layout.addWidget(self.results_card)
        layout.addStretch()
        self.content_stack.addWidget(page)

    def create_autostart_page(self):
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setSpacing(25)

        self.autostart_header = QLabel()
        self.autostart_header.setObjectName("main_title")
        layout.addWidget(self.autostart_header)
        
        self.autostart_subtitle = QLabel()
        self.autostart_subtitle.setObjectName("subtitle")
        layout.addWidget(self.autostart_subtitle)

        self.add_program_card = ProfessionalCard(icon="➕")
        add_program_layout = QFormLayout(self.add_program_card.content_widget)
        add_program_layout.setContentsMargins(10, 10, 10, 10)
        add_program_layout.setSpacing(10)

        line_edit_style = "padding: 8px; border: 1px solid #374151; border-radius: 4px; background: rgba(30, 41, 59, 0.5); color: #e2e8f0;"
        self.program_name_label = QLabel()
        self.program_name_input = QLineEdit()
        self.program_name_input.setStyleSheet(line_edit_style)
        add_program_layout.addRow(self.program_name_label, self.program_name_input)

        path_select_layout = QHBoxLayout()
        self.program_path_input = QLineEdit()
        self.program_path_input.setStyleSheet(line_edit_style)
        path_select_layout.addWidget(self.program_path_input)
        self.browse_path_btn = ModernButton("...", secondary=True)
        self.browse_path_btn.setFixedWidth(40)
        self.browse_path_btn.clicked.connect(self.select_program_path)
        path_select_layout.addWidget(self.browse_path_btn)
        self.program_path_label = QLabel()
        add_program_layout.addRow(self.program_path_label, path_select_layout)

        self.add_autostart_btn = ModernButton(primary=True)
        self.add_autostart_btn.clicked.connect(self.add_autostart_program)
        add_program_layout.addRow(self.add_autostart_btn)
        layout.addWidget(self.add_program_card)

        self.autostart_list_card = ProfessionalCard(icon="📄")
        autostart_list_layout = QVBoxLayout(self.autostart_list_card.content_widget)
        
        self.autostart_list = QListWidget()
        self.autostart_list.setStyleSheet("""
            QListWidget { background: rgba(30, 41, 59, 0.3); border: 1px solid #374151; border-radius: 8px; color: #e2e8f0; }
            QListWidget::item { margin-bottom: 5px; border: none; }
        """)
        autostart_list_layout.addWidget(self.autostart_list)

        self.refresh_autostart_btn = ModernButton(secondary=True)
        self.refresh_autostart_btn.clicked.connect(self.refresh_autostart_list)
        autostart_list_layout.addWidget(self.refresh_autostart_btn)
        layout.addWidget(self.autostart_list_card)
        layout.addStretch()
        self.content_stack.addWidget(page)

    def create_settings_page(self):
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setSpacing(25)

        self.settings_header = QLabel()
        self.settings_header.setObjectName("main_title")
        layout.addWidget(self.settings_header)
        
        self.settings_subtitle = QLabel()
        self.settings_subtitle.setObjectName("subtitle")
        layout.addWidget(self.settings_subtitle)

        self.settings_card = ProfessionalCard(icon="⚙️")
        settings_layout = QFormLayout(self.settings_card.content_widget)
        settings_layout.setContentsMargins(10, 10, 10, 10)
        settings_layout.setSpacing(10)
        
        combo_style = """
            QComboBox { padding: 8px; border: 1px solid #374151; border-radius: 4px; background: rgba(30, 41, 59, 0.5); color: #e2e8f0; }
            QComboBox::drop-down { border: 0px; } QComboBox::down-arrow { image: url(./icons/arrow_down.png); width: 12px; height: 12px; }
            QComboBox QAbstractItemView { background: #1f2937; border: 1px solid #374151; selection-background-color: #6366f1; color: #e2e8f0; }
        """
        self.lang_label = QLabel()
        self.lang_combo = QComboBox()
        self.lang_combo.addItems(["Polski", "English"])
        self.lang_combo.currentIndexChanged.connect(self.change_language)
        self.lang_combo.setStyleSheet(combo_style)
        settings_layout.addRow(self.lang_label, self.lang_combo)

        self.theme_label = QLabel()
        self.theme_combo = QComboBox()
        self.theme_combo.currentIndexChanged.connect(self.change_theme)
        self.theme_combo.setStyleSheet(combo_style)
        settings_layout.addRow(self.theme_label, self.theme_combo)

        self.export_data_label = QLabel()
        self.export_report_btn = ModernButton(secondary=True)
        self.export_report_btn.clicked.connect(self.export_system_info)
        settings_layout.addRow(self.export_data_label, self.export_report_btn)

        self.save_settings_btn = ModernButton(primary=True)
        self.save_settings_btn.clicked.connect(self.save_settings)
        settings_layout.addRow(self.save_settings_btn)

        layout.addWidget(self.settings_card)
        layout.addStretch()
        self.content_stack.addWidget(page)
    
    def set_card_title(self, card, title_key):
        title_label = card.findChild(QLabel, "card_title_label")
        if title_label:
            title_label.setText(self.tr(title_key))

    def update_ui_texts(self):
        self.setWindowTitle(self.tr("app_name"))
        # Sidebar
        self.sidebar_title.setText(self.tr("app_name").split(" ")[0])
        self.sidebar_subtitle.setText(self.tr("professional_suite"))
        self.status_indicator.set_status(self.status_indicator.status, self.tr(self.status_indicator.message_key))
        self.set_card_title(self.sys_info_card, "system_info")

        # Nav Buttons
        nav_keys = ["dashboard", "maintenance", "file_finder", "autostart", "settings"]
        for i, key in enumerate(nav_keys):
            icon = self.nav_buttons[i].text().split(" ")[0]
            self.nav_buttons[i].setText(f"{icon}  {self.tr(key)}")

        # Dashboard
        self.dashboard_header.setText(self.tr("dashboard"))
        self.dashboard_subtitle.setText(self.tr("monitor_performance_realtime"))
        self.set_card_title(self.cpu_card, "cpu_usage")
        self.set_card_title(self.ram_card, "ram_usage")
        self.set_card_title(self.disk_card, "disk_usage")
        self.set_card_title(self.processes_card, "active_processes")
        # Update disk info label carefully
        if "GB" not in self.disk_info_label.text():
            self.disk_info_label.setText(self.tr("loading"))

        # Maintenance
        self.maintenance_header.setText(self.tr("maintenance"))
        self.maintenance_subtitle.setText(self.tr("automatic_optimization_cleaning"))
        self.set_card_title(self.tasks_card, "available_tasks")
        self.set_card_title(self.presets_card, "presets")
        self.set_card_title(self.control_card, "control")
        self.set_card_title(self.progress_widget, "operation_progress")
        self.terminal_widget.set_title(self.tr("terminal"))
        self.full_maintenance_btn.setText(self.tr("full_maintenance"))
        self.disk_only_btn.setText(self.tr("disk_only"))
        for task_id, checkbox in self.task_checkboxes.items():
            icon = checkbox.text().split(" ")[0]
            checkbox.setText(f"{icon} {self.tr(task_id)}")
        for desc_key, label in self.task_desc_labels.items():
            label.setText(self.tr(desc_key))
        self.shutdown_checkbox.setText(self.tr("shutdown_after_finish"))
        self.start_maintenance_btn.setText(self.tr("start_maintenance"))
        self.progress_widget.overall_label.setText(self.tr("ready_to_start"))
        self.progress_widget.current_label.setText(self.tr("waiting_to_start"))
        
        # File Finder
        self.file_finder_header.setText(self.tr("large_files_finder"))
        self.file_finder_subtitle.setText(self.tr("find_and_manage_large_files"))
        self.set_card_title(self.scan_settings_card, "scan_settings")
        self.set_card_title(self.results_card, "scan_results")
        self.select_folder_btn.setText(self.tr("select_folder"))
        self.files_to_find_label.setText(self.tr("number_of_files_to_find"))
        self.start_scan_btn.setText(self.tr("start_scan"))

        # Autostart
        self.autostart_header.setText(self.tr("autostart_management"))
        self.autostart_subtitle.setText(self.tr("manage_startup_programs"))
        self.set_card_title(self.add_program_card, "add_autostart_program")
        self.set_card_title(self.autostart_list_card, "startup_programs_list")
        self.program_name_label.setText(self.tr("program_name"))
        self.program_name_input.setPlaceholderText(self.tr("program_name_placeholder"))
        self.program_path_label.setText(self.tr("program_path"))
        self.program_path_input.setPlaceholderText(self.tr("program_path_placeholder"))
        self.add_autostart_btn.setText(self.tr("add"))
        self.refresh_autostart_btn.setText(self.tr("refresh_list"))
        self.refresh_autostart_list() # Re-translate items

        # Settings
        self.settings_header.setText(self.tr("app_settings"))
        self.settings_subtitle.setText(self.tr("configure_application_settings"))
        self.set_card_title(self.settings_card, "app_settings")
        self.lang_label.setText(self.tr("language"))
        self.theme_label.setText(self.tr("theme"))
        self.theme_combo.clear() # Clear and add translated items
        self.theme_combo.addItems([self.tr("professional_theme"), self.tr("dark_blue_theme")])
        self.export_data_label.setText(self.tr("export_data"))
        self.export_report_btn.setText(self.tr("export_report"))
        self.save_settings_btn.setText(self.tr("save_settings"))

    def change_language(self, index):
        self.current_lang = "pl" if index == 0 else "en"
        self.update_ui_texts()

    def change_theme(self, index):
        theme_map = {0: "professional", 1: "dark_blue"}
        self.apply_theme(theme_map.get(index, "professional"))

    def start_monitoring(self):
        self.monitor_timer = QTimer(self)
        self.monitor_timer.timeout.connect(self.update_system_stats)
        self.monitor_timer.start(1000)
        
        self.process_timer = QTimer(self)
        self.process_timer.timeout.connect(self.update_processes)
        self.process_timer.start(5000)

    def update_system_stats(self):
        if not self.monitoring_active: return
        
        cpu_percent = psutil.cpu_percent()
        self.cpu_label.setText(f"{cpu_percent:.1f}%")
        self.cpu_chart.add_data_point(cpu_percent)
        
        ram = psutil.virtual_memory()
        self.ram_label.setText(f"{ram.percent:.1f}%")
        self.ram_chart.add_data_point(ram.percent)
        
        try:
            disk = psutil.disk_usage(Path.home().anchor)
            self.disk_progress.setValue(int(disk.percent))
            gb = 1024**3
            self.disk_info_label.setText(f"{disk.used/gb:.1f} GB / {disk.total/gb:.1f} GB {self.tr('used')}")
        except Exception:
            self.disk_info_label.setText(self.tr("disk_read_error"))
        
        if cpu_percent > 90 or ram.percent > 95:
            self.status_indicator.set_status("error", "critical_load")
        elif cpu_percent > 80 or ram.percent > 85:
            self.status_indicator.set_status("warning", "high_load")
        else:
            self.status_indicator.set_status("ok", "system_ok")
    
    def update_processes(self):
        if not hasattr(self, 'processes_list') or not self.processes_list.isVisible(): return
        try:
            processes = sorted(psutil.process_iter(['pid', 'name', 'cpu_percent', 'memory_percent']), 
                               key=lambda p: p.info['cpu_percent'] or 0, reverse=True)
            
            self.processes_list.clear()
            for proc in processes[:20]:
                cpu = proc.info['cpu_percent'] or 0
                mem = proc.info['memory_percent'] or 0
                item_text = f"PID: {proc.info['pid']:>6} | CPU: {cpu:>5.1f}% | RAM: {mem:>5.1f}% | {proc.info['name']}"
                self.processes_list.addItem(item_text)
        except (psutil.NoSuchProcess, psutil.AccessDenied, Exception):
            pass

    def start_resource_logging(self):
        self.logger_timer = QTimer(self)
        self.logger_timer.timeout.connect(self.log_current_resources)
        self.logger_timer.start(10000)

    def log_current_resources(self):
        if not self.monitoring_active: return
        self.backend.log_resource_usage()

    def select_full_preset(self):
        for checkbox in self.task_checkboxes.values(): checkbox.setChecked(True)

    def select_disk_preset(self):
        disk_tasks = ["disk_cleanup", "optimize_storage", "empty_trash", "temp_folders"]
        for task_id, checkbox in self.task_checkboxes.items():
            checkbox.setChecked(task_id in disk_tasks)

    def start_maintenance(self):
        selected_tasks = [task_id for task_id, checkbox in self.task_checkboxes.items() if checkbox.isChecked()]
        if not selected_tasks:
            QMessageBox.warning(self, self.tr("warning"), self.tr("no_tasks_selected"))
            return
        
        self.start_maintenance_btn.setEnabled(False)
        self.progress_widget.start_progress(len(selected_tasks))
        self.terminal_widget.clear_output()
        self.terminal_widget.append_output(self.tr("starting_maintenance"), "info")
        
        self.maintenance_thread = MaintenanceThread(selected_tasks, self.backend, self.current_lang)
        self.maintenance_thread.progress_updated.connect(lambda name: self.progress_widget.update_progress(name))
        self.maintenance_thread.task_completed.connect(self.progress_widget.complete_task)
        self.maintenance_thread.command_output.connect(lambda text, type: self.terminal_widget.append_output(text, type))
        self.maintenance_thread.finished.connect(self.maintenance_finished)
        self.maintenance_thread.start()

    def maintenance_finished(self):
        self.start_maintenance_btn.setEnabled(True)
        QMessageBox.information(self, self.tr("success"), self.tr("maintenance_finished"))
        if self.shutdown_checkbox.isChecked():
            reply = QMessageBox.question(self, self.tr("shutdown"), self.tr("confirm_shutdown"),
                                           QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No)
            if reply == QMessageBox.StandardButton.Yes:
                self.backend.shutdown_system()

    def select_scan_folder(self):
        folder = QFileDialog.getExistingDirectory(self, self.tr("select_folder"))
        if folder: self.folder_path_label.setText(folder)

    def start_file_scan(self):
        folder_path = self.folder_path_label.text()
        if not os.path.isdir(folder_path):
            QMessageBox.warning(self, self.tr("error"), self.tr("select_valid_folder"))
            return
        
        self.start_scan_btn.setEnabled(False)
        self.start_scan_btn.setText(self.tr("scanning"))
        self.results_list.clear()
        
        self.scan_thread = FileScanThread(folder_path, self.files_count_slider.value(), self.backend)
        self.scan_thread.files_found.connect(self.update_scan_results)
        self.scan_thread.finished.connect(lambda: (self.start_scan_btn.setEnabled(True), self.start_scan_btn.setText(self.tr("start_scan"))))
        self.scan_thread.start()

    def update_scan_results(self, files):
        self.results_list.clear()
        for size, path in files:
            size_mb = size / (1024 * 1024)
            size_str = f"{size_mb/1024:.2f} GB" if size_mb >= 1024 else f"{size_mb:.2f} MB"
            item_text = f"{size_str:>10} | {path.name}\n{'':>12} {path.parent}"
            item = QListWidgetItem(item_text)
            item.setData(Qt.ItemDataRole.UserRole, str(path))
            self.results_list.addItem(item)

    def open_file_location(self, item):
        self.backend.open_file_location(item.data(Qt.ItemDataRole.UserRole))

    def refresh_autostart_list(self):
        self.autostart_list.clear()
        self.autostart_thread = AutostartThread(self.backend)
        self.autostart_thread.programs_loaded.connect(self.update_autostart_list)
        self.autostart_thread.start()

    def update_autostart_list(self, programs):
        self.autostart_list.clear()
        for program in programs:
            item = QListWidgetItem(self.autostart_list)
            item_widget = AutostartItemWidget(program, self.tr("enable"), self.tr("disable"))
            item_widget.remove_requested.connect(self.remove_autostart_program)
            item_widget.toggle_requested.connect(self.toggle_autostart_program)
            item.setSizeHint(item_widget.sizeHint())
            self.autostart_list.addItem(item)
            self.autostart_list.setItemWidget(item, item_widget)

    def select_program_path(self):
        file_path, _ = QFileDialog.getOpenFileName(self, self.tr("select_program_path"), "", "All Files (*);;Executable Files (*.exe *.app *.sh)")
        if file_path: self.program_path_input.setText(file_path)

    def add_autostart_program(self):
        name, path = self.program_name_input.text().strip(), self.program_path_input.text().strip()
        if not name or not path:
            QMessageBox.warning(self, self.tr("warning"), self.tr("name_path_required"))
            return
        
        if self.backend.add_startup_program(name, path, live_output_callback=self.terminal_widget.append_output):
            QMessageBox.information(self, self.tr("success"), self.tr("program_added"))
            self.program_name_input.clear()
            self.program_path_input.clear()
            self.refresh_autostart_list()
        else:
            QMessageBox.critical(self, self.tr("error"), self.tr("failed_to_add_program"))

    def remove_autostart_program(self, program_data):
        reply = QMessageBox.question(self, self.tr("remove_program"), self.tr("confirm_remove"),
                                       QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No)
        if reply == QMessageBox.StandardButton.Yes:
            if self.backend.remove_startup_program(program_data, live_output_callback=self.terminal_widget.append_output):
                QMessageBox.information(self, self.tr("success"), self.tr("program_removed"))
                self.refresh_autostart_list()
            else:
                QMessageBox.critical(self, self.tr("error"), self.tr("failed_to_remove_program"))

    def toggle_autostart_program(self, program_data, enable):
        if self.backend.toggle_startup_program(program_data, enable, live_output_callback=self.terminal_widget.append_output):
            QMessageBox.information(self, self.tr("success"), self.tr("program_enabled") if enable else self.tr("program_disabled"))
            self.refresh_autostart_list()
        else:
            QMessageBox.critical(self, self.tr("error"), self.tr("failed_to_toggle_program"))

    def export_system_info(self):
        path, _ = QFileDialog.getSaveFileName(self, self.tr("save_system_report"), f"system_report_{int(time.time())}.txt", "Text files (*.txt)")
        if path:
            self.backend.export_system_info(path)
            QMessageBox.information(self, self.tr("success"), self.tr("report_exported"))

    def save_settings(self):
        config = {
            "language": self.lang_combo.currentText(),
            "theme_key": self.current_theme_key,
            "shutdown_on_finish": self.shutdown_checkbox.isChecked(),
        }
        try:
            with open("config.json", "w") as f:
                json.dump(config, f, indent=4)
            QMessageBox.information(self, self.tr("success"), self.tr("settings_saved"))
        except Exception as e:
            QMessageBox.critical(self, self.tr("error"), f"{self.tr('settings_save_error')}: {e}")

    def load_config(self):
        try:
            with open("config.json", "r") as f: config = json.load(f)
            
            # Language
            lang_text = config.get("language", "Polski")
            if lang_text == "English":
                self.lang_combo.setCurrentIndex(1)
                self.current_lang = "en"
            else:
                self.lang_combo.setCurrentIndex(0)
                self.current_lang = "pl"

            # Theme
            self.current_theme_key = config.get("theme_key", "professional")
            theme_map_keys = {"professional": 0, "dark_blue": 1}
            self.theme_combo.setCurrentIndex(theme_map_keys.get(self.current_theme_key, 0))

            self.shutdown_checkbox.setChecked(config.get("shutdown_on_finish", False))
        except (FileNotFoundError, json.JSONDecodeError):
            self.current_lang = "pl"
            self.current_theme_key = "professional"

    def closeEvent(self, event):
        self.monitoring_active = False
        for timer in [getattr(self, t, None) for t in ['logger_timer', 'monitor_timer', 'process_timer']]:
            if timer: timer.stop()
        event.accept()

# --- THREADS ---
class MaintenanceThread(QThread):
    progress_updated = pyqtSignal(str)
    task_completed = pyqtSignal()
    command_output = pyqtSignal(str, str)

    def __init__(self, tasks, backend, lang):
        super().__init__()
        self.tasks = tasks
        self.backend = backend
        self.translations_data = get_translations()
        self.current_lang = lang

    def tr(self, key): return self.translations_data.get(key, {}).get(self.current_lang, key)
    def _live_output(self, text, type): self.command_output.emit(text, type)

    def run(self):
        task_map = { "diagnostics": self.backend.run_diagnostics, "temp_folders": self.backend.clean_temp_folders,
                     "disk_cleanup": self.backend.cleanup_disk_space, "empty_trash": self.backend.empty_trash,
                     "optimize_storage": self.backend.optimize_storage, "system_updates": self.backend.run_system_updates }
        
        for task_id in self.tasks:
            task_name = self.tr(task_id)
            self.progress_updated.emit(task_name)
            self.command_output.emit(f"\n{self.tr('starting_task')} {task_name} ---", "info")
            
            if task_id in task_map: task_map[task_id](live_output_callback=self._live_output)
            else: self.command_output.emit(f"{self.tr('unknown_task')} {task_id}", "error")
            
            self.command_output.emit(f"{self.tr('task_completed')} {task_name} ---\n", "success")
            self.task_completed.emit()
            time.sleep(0.5)

class FileScanThread(QThread):
    files_found = pyqtSignal(list)
    def __init__(self, path, count, backend): super().__init__(); self.path, self.count, self.backend = path, count, backend
    def run(self): self.backend.find_large_files(self.path, self.count, lambda files: self.files_found.emit(files))

class AutostartThread(QThread):
    programs_loaded = pyqtSignal(list)
    def __init__(self, backend): super().__init__(); self.backend = backend
    def run(self): self.programs_loaded.emit(self.backend.get_startup_programs())

if __name__ == "__main__":
    app = QApplication(sys.argv)
    app.setApplicationName("System Care Professional")
    app.setApplicationVersion("2.1")
    app.setOrganizationName("Kosma Brzeżawski")
    
    window = SystemCareApp()
    window.show()
    sys.exit(app.exec())