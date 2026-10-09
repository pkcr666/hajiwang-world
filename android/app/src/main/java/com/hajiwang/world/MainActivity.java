package com.hajiwang.world;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        applyImmersiveFullscreen();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // 沉浸式 sticky：系统栏被用户滑动临时唤出后，重新获得焦点时再次隐藏
        if (hasFocus) {
            applyImmersiveFullscreen();
        }
    }

    /**
     * 真全屏（沉浸式）：让内容延伸到屏幕边缘（edge-to-edge），
     * 并隐藏系统状态栏与导航栏，彻底去除上下白框。
     * 用户从边缘滑动可临时唤出系统栏（transient），松开后自动再次隐藏。
     */
    private void applyImmersiveFullscreen() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (controller != null) {
            controller.hide(WindowInsetsCompat.Type.systemBars());
            controller.setSystemBarsBehavior(
                    WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        }
    }
}