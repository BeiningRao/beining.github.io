const username = "beining";
const apiURL = `https://api.github.com/users/${username}`;

const nameElement = document.querySelector("#name");
const bioElement = document.querySelector("#bio");
const avatarElement = document.querySelector("#avatar");
const profileLink = document.querySelector("#profile-link");
const reposElement = document.querySelector("#repos");
const followersElement = document.querySelector("#followers");
const followingElement = document.querySelector("#following");
const noticeElement = document.querySelector("#notice");

function formatName(profile) {
  return profile.name || profile.login || "GitHub User";
}

function setFallback() {
  nameElement.textContent = "Bei Ning";
  bioElement.textContent = "这里展示的是基于 GitHub 资料生成的个人主页。";
  noticeElement.textContent = "未能实时拉取 GitHub API，已显示默认信息。";
}

async function loadProfile() {
  profileLink.href = `https://github.com/${username}`;

  try {
    const response = await fetch(apiURL, {
      headers: { Accept: "application/vnd.github+json" },
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const profile = await response.json();

    nameElement.textContent = formatName(profile);
    bioElement.textContent =
      profile.bio || "这个人很低调，还没有写简介。";
    avatarElement.src = profile.avatar_url;
    avatarElement.alt = `${formatName(profile)} 的 GitHub 头像`;
    reposElement.textContent = String(profile.public_repos ?? "-");
    followersElement.textContent = String(profile.followers ?? "-");
    followingElement.textContent = String(profile.following ?? "-");
    profileLink.href = profile.html_url || profileLink.href;
    noticeElement.textContent = "";
  } catch {
    setFallback();
  }
}

loadProfile();
