<script setup lang="ts">
import { useRouter } from "vue-router";
import ArenaAdmin from "../components/ArenaAdmin.vue";

const router = useRouter();
</script>

<template>
  <ArenaAdmin @go-battle="router.push('/test/battle')" />
</template>
